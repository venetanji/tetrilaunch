import { createAchievementSync, syncSteamAchievements } from '../src/lib/steam';

type Check = (name: string, condition: boolean, detail?: string) => void;

export async function checkSteamTransport(check: Check): Promise<void> {
  {
    const calls: string[] = [];
    const sync = createAchievementSync(async (id) => {
      calls.push(id);
      return true;
    });
    await sync([]);
    check('Steam transport skips empty achievement lists', calls.length === 0);
    await sync(['FIRST', 'FIRST', 'SECOND']);
    await sync(['SECOND', 'FIRST']);
    check('Steam transport deduplicates and remembers session successes',
      calls.join(',') === 'FIRST,SECOND', calls.join(','));
  }

  {
    const calls: string[] = [];
    let available = false;
    const sync = createAchievementSync(async (id) => {
      calls.push(id);
      if (!available && id === 'REJECTED') throw new Error('Steam unavailable');
      return available;
    });
    let resolved = true;
    try {
      await sync(['UNAVAILABLE', 'REJECTED']);
    } catch {
      resolved = false;
    }
    check('Steam transport contains bridge rejections', resolved);
    check('Steam transport attempts unavailable achievements once per sync',
      calls.join(',') === 'UNAVAILABLE,REJECTED', calls.join(','));
    available = true;
    await sync(['UNAVAILABLE', 'REJECTED']);
    await sync(['UNAVAILABLE', 'REJECTED']);
    check('Steam transport retries false and rejected results on the next sync',
      calls.join(',') === 'UNAVAILABLE,REJECTED,UNAVAILABLE,REJECTED', calls.join(','));
  }

  {
    const calls: string[] = [];
    let releaseFirst = () => {};
    const firstResult = new Promise<boolean>((resolve) => {
      releaseFirst = () => resolve(true);
    });
    let active = 0;
    let peakActive = 0;
    const sync = createAchievementSync(async (id) => {
      calls.push(id);
      active++;
      peakActive = Math.max(peakActive, active);
      const result = id === 'FIRST' ? await firstResult : true;
      active--;
      return result;
    });
    const firstSync = sync(['FIRST']);
    await Promise.resolve();
    const overlappingSync = sync(['FIRST', 'SECOND', 'SECOND']);
    await Promise.resolve();
    check('Steam transport serializes overlapping unlock requests',
      calls.join(',') === 'FIRST' && peakActive === 1, calls.join(','));
    releaseFirst();
    await Promise.all([firstSync, overlappingSync]);
    check('Steam transport retains new IDs from overlapping sync requests',
      calls.join(',') === 'FIRST,SECOND' && peakActive === 1, calls.join(','));
  }

  {
    const calls: string[] = [];
    let releaseFirst = () => {};
    const firstResult = new Promise<boolean>((resolve) => {
      releaseFirst = () => resolve(false);
    });
    const sync = createAchievementSync(async (id) => {
      calls.push(id);
      return calls.length === 1 ? firstResult : false;
    });
    const firstSync = sync(['RETRY']);
    await Promise.resolve();
    const overlappingSync = sync(['RETRY', 'NEW']);
    releaseFirst();
    await Promise.all([firstSync, overlappingSync]);
    check('Steam transport does not spin retrying failures in an overlapping sync',
      calls.join(',') === 'RETRY,NEW', calls.join(','));
    await sync(['RETRY']);
    check('Steam transport retries a previous overlapping failure on a later sync',
      calls.join(',') === 'RETRY,NEW,RETRY', calls.join(','));
  }

  {
    const calls: string[] = [];
    const unlock = async (id: string) => {
      calls.push(id);
      return true;
    };
    await createAchievementSync(unlock)(['EARNED']);
    await createAchievementSync(unlock)(['EARNED']);
    check('Steam transport reconciles achievements again in a new session',
      calls.join(',') === 'EARNED,EARNED', calls.join(','));
  }

  await syncSteamAchievements(['NO_BROWSER']);
  check('Steam transport tolerates an absent browser bridge', true);
}
