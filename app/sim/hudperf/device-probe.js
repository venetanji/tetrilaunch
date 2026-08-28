(async () => {
  const TARGETS = ['pixel-sparkle', 'belt-arrow-pulse'];
  const SWITCH_MS = 400, DURATION_MS = 24000;

  // Stamp the owning SURFACES once — the element itself, its ::before, or its
  // ::after, whichever the target animation actually runs on. Stamping the
  // element and stilling all three surfaces (the first version of this probe)
  // would also still whatever else those surfaces run — in a congested bay the
  // crest pixels carry crest-spark on ::before and jiggle/rattle on the element
  // itself — and the off arm would then bill those animations to the two
  // targets. Toggling happens on the stylesheet's `disabled` flag, one cheap
  // operation, so the 400ms cadence never dirties attributes mid-measurement.
  //
  // effect.pseudoElement is how a surface is known. On an engine too old to
  // report it (undefined, not null) the surface is UNKNOWN, and the probe
  // treats the whole element as the stilled surface — which is why the guard
  // below is what makes the run honest there.
  const ATTR = { self: 'data-kf-off-self', '::before': 'data-kf-off-before', '::after': 'data-kf-off-after' };
  const surfOf = (a) => {
    const p = a.effect && a.effect.pseudoElement;
    return p === undefined ? 'unknown' : (p || 'self');
  };
  const want = new Set(TARGETS);
  let stamped = 0;
  for (const a of document.getAnimations()) {
    if (!a.animationName || !want.has(a.animationName)) continue;
    const el = a.effect && a.effect.target;
    if (!(el instanceof Element)) continue;
    const s = surfOf(a);
    if (s === 'unknown') { el.setAttribute(ATTR.self, ''); el.setAttribute(ATTR['::before'], ''); el.setAttribute(ATTR['::after'], ''); }
    else el.setAttribute(ATTR[s], '');
    stamped++;
  }
  const unstamp = () => { for (const attr of Object.values(ATTR)) for (const el of document.querySelectorAll('[' + attr + ']')) el.removeAttribute(attr); };
  if (!stamped) { unstamp(); return JSON.stringify({ error: 'none of the target animations are running here', running: [...new Set(document.getAnimations().map(a => a.animationName).filter(Boolean))] }); }

  // THE GUARD. A stilled surface must carry ONLY target animations, or the off
  // arm measures more than it claims: `animation: none` on a surface kills
  // every animation on it, so a crest pixel that has picked up a congestion
  // animation would have that stilled too and its saving credited to the
  // targets. Checked before the run (abort — the operator should retry on a
  // calm bay) and again after it (VOID — congestion that arrived mid-run
  // contaminated the arms already recorded).
  const collateral = () => {
    const out = [];
    for (const a of document.getAnimations()) {
      const n = a.animationName;
      if (!n || want.has(n)) continue;
      const el = a.effect && a.effect.target;
      if (!(el instanceof Element)) continue;
      const s = surfOf(a);
      const hit = s === 'self' ? el.hasAttribute(ATTR.self)
        : s === '::before' ? el.hasAttribute(ATTR['::before'])
        : s === '::after' ? el.hasAttribute(ATTR['::after'])
        : Object.values(ATTR).some((attr) => el.hasAttribute(attr));
      if (hit) out.push(n + (s === 'self' ? '' : ':' + s));
    }
    return [...new Set(out)];
  };
  const dirty = collateral();
  if (dirty.length) { unstamp(); return JSON.stringify({ error: 'a stilled surface also carries non-target animations; retry on a calm bay', collateral: dirty }); }

  const sheet = document.createElement('style');
  sheet.textContent = '[' + ATTR.self + '] { animation: none !important; } ' +
    '[' + ATTR['::before'] + ']::before { animation: none !important; } ' +
    '[' + ATTR['::after'] + ']::after { animation: none !important; }';
  document.head.appendChild(sheet);

  const arms = { on: [], off: [] };   // 'on' = animations running (control)
  let cur = 'on'; sheet.disabled = true;
  let last = 0, switched = true;
  const t0 = performance.now();
  let lastSwitch = t0;

  await new Promise(res => {
    const tick = () => {
      const now = performance.now();
      if (now - lastSwitch >= SWITCH_MS) {
        cur = cur === 'on' ? 'off' : 'on';
        sheet.disabled = (cur === 'on');
        lastSwitch = now; switched = true;
      }
      if (last) {
        // Drop the first gap after a switch: it straddles two conditions and
        // also pays for the style invalidation the switch itself caused.
        if (switched) switched = false; else arms[cur].push(now - last);
      }
      last = now;
      if (now - t0 < DURATION_MS) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });

  // The sheet comes off BEFORE the closing guard runs: a stilled animation is
  // absent from getAnimations() entirely, so checking while the sheet is live
  // (or after a run that ended mid-'off') would be blind to exactly the
  // animations it exists to catch. getAnimations() forces the style update, so
  // no settling frame is needed. A congestion animation that came AND went
  // between the two guards is still invisible — the probe's honesty is the two
  // endpoints, not the whole path.
  sheet.remove();
  const dirtyAfter = collateral();
  unstamp();

  const stat = (g) => {
    if (g.length < 30) return { frames: g.length, error: 'too few' };
    const s = [...g].sort((a,b)=>a-b);
    const secs = g.reduce((a,b)=>a+b,0)/1000;
    return {
      frames: g.length, fps: +(g.length/secs).toFixed(1),
      minGap: +s[0].toFixed(2), p50: +s[Math.floor(s.length/2)].toFixed(2),
      p90: +s[Math.floor(s.length*0.9)].toFixed(2),
      onTime90Hz: +(g.filter(x=>x<=(1000/90)*1.05).length/g.length*100).toFixed(1),
    };
  };
  const on = stat(arms.on), off = stat(arms.off);
  return JSON.stringify({
    stamped, targets: TARGETS,
    animationsRunning: on, animationsStilled: off,
    deltaFps: (on.fps!=null&&off.fps!=null) ? +(off.fps - on.fps).toFixed(1) : null,
    deltaOnTime: (on.onTime90Hz!=null&&off.onTime90Hz!=null) ? +(off.onTime90Hz - on.onTime90Hz).toFixed(1) : null,
    vsync: Math.min(on.minGap??99, off.minGap??99) < 13 ? 'ABOVE 60Hz confirmed' : 'VOID — 60Hz window',
    verdict: dirtyAfter.length ? 'VOID — congestion animations joined a stilled surface mid-run' : 'clean',
    collateral: dirtyAfter,
    inBay: !!document.getElementById('game'),
  }, null, 1);
})()
