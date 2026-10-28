/** Steam Auto-Cloud owns a JSON file, not the browser profile. Keep account
 * progression in memory so switching Steam users cannot reuse a shared cache. */
type Values = Record<string, string>;
type LocalStore = Pick<Storage, 'getItem' | 'setItem'>;
interface SaveBridge {
  open(legacy: Values): Promise<Values>;
  write(values: Values): Promise<void>;
}
declare global {
  interface Window {
    desktopSave?: SaveBridge;
    flushDesktopSave?: (closing?: boolean) => Promise<void>;
  }
}
const PROGRESS_KEYS = ['tetrilaunch.meta', 'tetrilaunch.name', 'tetrilaunch.best',
  'tetrilaunch.best.sandbox', 'tetrilaunch.bays', 'tetrilaunch.onboarding'];
const FLAGS = ['seenDragHint', 'seenTutorial', 'devMode'];
const SETTINGS = 'tetrilaunch.settings';
function parseSettings(raw: string | null): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function flags(settings: Record<string, unknown>): Record<string, boolean> {
  return Object.fromEntries(FLAGS.map(key => [key, settings[key] === true]));
}
export function createProgressStorage(local: LocalStore, bridge: SaveBridge, onError: (error: Error) => void) {
  let values: Values = {}, ready = false, frozen = false;
  let pending: Promise<void> = Promise.resolve();
  let failure: Error | undefined;
  function requireReady(): void { if (!ready) throw new Error('Account save is not ready'); }
  function write(): void {
    // Invoke immediately: native IPC owns serialization. Keep the latest
    // promise for close/quit, and make failures visible rather than fire-and-forget.
    pending = bridge.write({ ...values }).then(() => { failure = undefined; }, error => {
      failure = error instanceof Error ? error : new Error(String(error));
      onError(failure);
    });
  }
  return {
    async open(): Promise<void> {
      const legacy: Values = {};
      for (const key of PROGRESS_KEYS) {
        const value = local.getItem(key);
        if (value !== null) legacy[key] = value;
      }
      legacy['tetrilaunch.onboarding'] = JSON.stringify(flags(parseSettings(local.getItem(SETTINGS))));
      values = await bridge.open(legacy);
      ready = true;
    },
    getItem(key: string): string | null {
      requireReady();
      if (key === SETTINGS) {
        const device = parseSettings(local.getItem(SETTINGS));
        const progress = JSON.parse(values['tetrilaunch.onboarding'] || '{}');
        return JSON.stringify({ ...device, ...flags(progress) });
      }
      return PROGRESS_KEYS.includes(key) ? values[key] ?? null : local.getItem(key);
    },
    setItem(key: string, value: string): void {
      requireReady();
      if (frozen) throw new Error('Save is closing');
      if (key === SETTINGS) {
        const settings = JSON.parse(value);
        values['tetrilaunch.onboarding'] = JSON.stringify(flags(settings));
        for (const flag of FLAGS) delete settings[flag];
        // A full Chromium profile must not prevent account progress reaching
        // its independent file; device preference failures remain local.
        try { local.setItem(key, JSON.stringify(settings)); } catch { /* device preferences unavailable */ }
      } else if (PROGRESS_KEYS.includes(key)) values[key] = value;
      else { local.setItem(key, value); return; }
      write();
    },
    freeze(): void { frozen = true; },
    unfreeze(): void { frozen = false; },
    async flush(): Promise<void> {
      await pending;
      if (failure) { write(); await pending; }
      if (failure) throw failure;
    },
  };
}
let accountStorage: ReturnType<typeof createProgressStorage> | undefined;
export const progressStorage: LocalStore = {
  getItem: key => (accountStorage ?? localStorage).getItem(key),
  setItem: (key, value) => (accountStorage ?? localStorage).setItem(key, value),
};
function showSaveError(error: Error): void {
  window.dispatchEvent(new Event('desktop-save-quiesce'));
  let notice = document.getElementById('desktop-save-error');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'desktop-save-error'; notice.setAttribute('role', 'alert');
    Object.assign(notice.style, { position:'fixed', inset:'0', zIndex:'2147483647',
      background:'#07070f', color:'white', padding:'3rem', font:'18px sans-serif' });
    document.body.append(notice);
  }
  // Never insert native errors as HTML. Keep the save intact and offer an
  // explicit retry instead of letting the constructor create default progress.
  notice.replaceChildren();
  const text = document.createElement('p');
  text.textContent = `Progress could not be saved or loaded. Your existing save has not been reset. ${error.message}`;
  const retry = document.createElement('button');
  retry.textContent = 'Retry save';
  retry.onclick = () => {
    if (!accountStorage) { location.reload(); return; }
    void accountStorage.flush().then(() => {
      notice?.remove(); window.dispatchEvent(new Event('desktop-save-resume'));
    }).catch(showSaveError);
  };
  const restart = document.createElement('p');
  restart.textContent = 'For a Steam account or damaged-save error, close the game and restore the save or restart through Steam. Keep any existing progress.json and .bak files.';
  notice.append(text,retry,restart);
}
export async function initializeDesktopSave(): Promise<void> {
  if (!window.desktopSave) return;
  const adapter = createProgressStorage(localStorage, window.desktopSave, showSaveError);
  try {
    await adapter.open();
    accountStorage = adapter;
    window.flushDesktopSave = async (closing = false) => {
      if (closing) {
        window.dispatchEvent(new Event('desktop-save-quiesce'));
        adapter.freeze();
      }
      try { await adapter.flush(); }
      catch (error) {
        adapter.unfreeze();
        window.dispatchEvent(new Event('desktop-save-resume'));
        throw error;
      }
    };
  } catch (error) {
    showSaveError(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
