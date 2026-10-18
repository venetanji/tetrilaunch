declare global {
  interface Window {
    steam?: {
      unlockAchievement(apiName: string): Promise<boolean>;
    };
  }
}

export function createAchievementSync(
  unlock: (id: string) => Promise<boolean>,
): (ids: readonly string[]) => Promise<void> {
  const succeeded = new Set<string>();
  const pending = new Set<string>();
  let running: Promise<void> | undefined;

  async function drain(): Promise<void> {
    const attempted = new Set<string>();
    while (pending.size) {
      const batch = [...pending];
      pending.clear();
      for (const id of batch) {
        if (succeeded.has(id) || attempted.has(id)) continue;
        attempted.add(id);
        try {
          if (await unlock(id)) succeeded.add(id);
        } catch {
          // Steam may be offline; the next sync retries unacknowledged IDs.
        }
      }
    }
    running = undefined;
  }

  return (ids) => {
    for (const id of ids) {
      if (!succeeded.has(id)) pending.add(id);
    }
    if (!running && pending.size) {
      // Defer the drain so even a synchronously throwing bridge is serialized.
      running = Promise.resolve().then(drain);
    }
    return running ?? Promise.resolve();
  };
}

export const syncSteamAchievements = createAchievementSync(async (id) => {
  if (typeof window === 'undefined' || !window.steam?.unlockAchievement) return false;
  return window.steam.unlockAchievement(id);
});
