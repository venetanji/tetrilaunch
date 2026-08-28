(async () => {
  const TARGETS = ['pixel-sparkle', 'belt-arrow-pulse'];
  const SWITCH_MS = 400, DURATION_MS = 24000;

  // Stamp the owning elements ONCE. Toggling an attribute every 400ms would
  // itself dirty style and land inside the thing being measured; toggling a
  // stylesheet's `disabled` flag is one cheap operation on the sheet.
  const want = new Set(TARGETS);
  let stamped = 0;
  for (const a of document.getAnimations()) {
    if (!a.animationName || !want.has(a.animationName)) continue;
    const el = a.effect && a.effect.target;
    if (el instanceof Element) { el.setAttribute('data-kf-off',''); stamped++; }
  }
  if (!stamped) return JSON.stringify({ error: 'none of the target animations are running here', running: [...new Set(document.getAnimations().map(a=>a.animationName).filter(Boolean))] });

  const sheet = document.createElement('style');
  sheet.textContent = '[data-kf-off], [data-kf-off]::before, [data-kf-off]::after { animation: none !important; }';
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

  sheet.remove();
  for (const el of document.querySelectorAll('[data-kf-off]')) el.removeAttribute('data-kf-off');

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
    inBay: !!document.getElementById('game'),
  }, null, 1);
})()
