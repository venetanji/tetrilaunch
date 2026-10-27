/** Capture-only WebAnimations clock; never installed by the shipped app. */
export function installCaptureCssClock(): void {
  const w = window as unknown as Record<string, any>;
  if (w.__captureCssClock) return;
  const entries = new WeakMap<Animation, { start: number; base: number; rate: number; moving: boolean }>();
  let elapsed = 0;
  let first = true;
  const sync = (delta = 0): void => {
    elapsed += delta;
    for (const animation of document.getAnimations()) {
      let entry = entries.get(animation);
      if (!entry) {
        const parked = animation.playState === 'paused' || animation.playState === 'finished';
        entry = { start: elapsed, base: first || parked ? Number(animation.currentTime ?? 0) : 0,
          rate: animation.playbackRate, moving: animation.playState !== 'paused' && animation.playState !== 'finished' };
        entries.set(animation, entry);
      }
      animation.pause();
      animation.currentTime = entry.base + (entry.moving ? (elapsed - entry.start) * entry.rate : 0);
    }
    first = false;
  };
  const snapshot = () => document.getAnimations().map(animation => {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    const style = target instanceof Element ? getComputedStyle(target, effect?.pseudoElement ?? null) : null;
    const timing = effect?.getTiming();
    return { name: (animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty ?? '',
      target: target instanceof Element ? target.className : '', currentTime: Number(animation.currentTime ?? 0),
      playState: animation.playState, delay: timing?.delay, duration: timing?.duration,
      transform: style?.transform, backgroundPositionX: style?.backgroundPositionX, opacity: style?.opacity };
  });
  w.__captureCssClock = { sync, snapshot, elapsed: () => elapsed };
  sync();
}

declare global {
  interface Window {
    __captureCssClock?: {
      sync(delta?: number): void;
      snapshot(): Array<{ name: string; target: string; currentTime: number; playState: string; delay?: number; duration?: number | string; transform?: string; backgroundPositionX?: string; opacity?: string }>;
      elapsed(): number;
    };
  }
}
