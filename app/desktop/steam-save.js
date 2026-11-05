const fs = require('node:fs/promises');
const path = require('node:path');
const MAX_BYTES = 1024 * 1024;
const KEYS = new Set(['tetrilaunch.meta', 'tetrilaunch.name', 'tetrilaunch.best',
  'tetrilaunch.best.sandbox', 'tetrilaunch.bays', 'tetrilaunch.onboarding']);
const FLAGS = new Set(['seenDragHint', 'seenTutorial', 'devMode']);
const account = v => typeof v === 'string' && /^\d{17}$/.test(v);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function validateValues(values) {
  if (!plain(values) || Buffer.byteLength(JSON.stringify(values)) > MAX_BYTES) throw new Error('Invalid save size');
  for (const [key, value] of Object.entries(values)) {
    if (!KEYS.has(key) || typeof value !== 'string') throw new Error('Invalid save key');
    if (key === 'tetrilaunch.name') {
      if (value.length > 128) throw new Error('Invalid player name');
    } else if (key === 'tetrilaunch.meta' || key === 'tetrilaunch.onboarding') {
      const parsed = JSON.parse(value);
      if (!plain(parsed)) throw new Error('Invalid progression object');
      if (key === 'tetrilaunch.onboarding') {
        if (Object.entries(parsed).some(([k,v]) => !FLAGS.has(k) || typeof v !== 'boolean')) throw new Error('Invalid progress flags');
      } else {
        // Meta has nested upgrade maps and string/number arrays. Reject values
        // the normal load migration would otherwise silently replace with defaults.
        const check = v => {
          if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw new Error('Invalid progression number');
          if (Array.isArray(v)) { for (const item of v) check(item); }
          else if (plain(v)) for (const [k,item] of Object.entries(v)) {
            if (['__proto__','prototype','constructor'].includes(k)) throw new Error('Invalid progression property');
            check(item);
          }
          else if (!['string','boolean','number'].includes(typeof v)) throw new Error('Invalid progression value');
        };
        check(parsed);
        for (const key of ['salvage','runs','bestBay','mark','celebratedMark','licence','tierContracts','slots']) {
          if (key in parsed && (!Number.isSafeInteger(parsed[key]) || parsed[key] < 0)) throw new Error('Invalid progression counter');
        }
        for (const key of ['seenContractBoard','seenDraft','seenRefit','tierRunDone','sealBreakSeen','skydeckCelebrated']) {
          if (key in parsed && typeof parsed[key] !== 'boolean') throw new Error('Invalid progression flag');
        }
        for (const key of ['unlocks','claimedContracts','systemDrillsSeen','stowed','achievements']) {
          if (key in parsed && (!Array.isArray(parsed[key]) || parsed[key].some(v=>typeof v!=='string'))) throw new Error('Invalid progression list');
        }
        if ('sealedMarks' in parsed && (!Array.isArray(parsed.sealedMarks) || parsed.sealedMarks.some(v=>!Number.isSafeInteger(v)||v<0))) throw new Error('Invalid seals');
        for (const key of ['loadout','acked']) if (key in parsed && !plain(parsed[key])) throw new Error('Invalid progression map');
        if (parsed.loadout && Object.values(parsed.loadout).some(v=>!Number.isSafeInteger(v)||v<0)) throw new Error('Invalid loadout');
        if (parsed.acked && Object.values(parsed.acked).some(v=>typeof v!=='string')) throw new Error('Invalid acknowledgements');
      }
    } else if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid progress counter');
  }
  return JSON.parse(JSON.stringify(values));
}
function saveRoot(platform, {appData, home}) {
  if (platform === 'win32') return path.join(appData, 'Tetrilaunch');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Tetrilaunch');
  if (platform === 'linux') return path.join(home, '.config', 'Tetrilaunch');
  throw new Error('Unsupported save platform');
}
async function readJson(file) {
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_BYTES * 2) throw new Error('Save exceeds size limit');
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!plain(value)) throw new Error('Invalid save envelope');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = file + '.tmp';
  const handle = await fs.open(temp, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
  // Windows does not support opening a directory for fsync. File data is
  // flushed before rename everywhere; POSIX also flushes the rename itself.
  if (process.platform !== 'win32') {
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
function createSaveStore({root, getAccountId}) {
  let accountId, opened = false, queue = Promise.resolve();
  const markerFile = path.join(root, 'migration.json');
  function identity() {
    const id = getAccountId();
    if (!account(id) || (accountId && id !== accountId)) throw new Error('Steam identity unavailable or changed; restart through Steam');
    return id;
  }
  function enqueue(fn) {
    const next = queue.then(fn);
    queue = next.catch(()=>{});
    return next;
  }
  async function open(legacy) {
    return enqueue(async()=>{
      const id = identity();
      const file = path.join(root, 'saves', id, 'progress.json');
      const saved = await readJson(file);
      let marker = await readJson(markerFile);
      if (marker) {
        if (marker.version !== 1 || !Array.isArray(marker.accounts) || marker.accounts.some(v=>!account(v)) || !account(marker.legacyOwner)) throw new Error('Invalid migration state');
        if ('pending' in marker) {
          if (!plain(marker.pending) || marker.pending.accountId !== marker.legacyOwner || marker.accounts.includes(marker.pending.accountId)) throw new Error('Invalid migration journal');
          validateValues(marker.pending.values);
        }
      }
      let values;
      if (saved) {
        if (saved.version !== 1 || saved.accountId !== id) throw new Error('Unsupported or wrong-account save');
        values = validateValues(saved.values);
      } else {
        if (marker?.accounts.includes(id)) throw new Error('Previously initialized save is missing; restore it before playing');
        if (!marker) {
          values = validateValues(legacy);
          // Journal legacy content before creating a save. A crash can resume
          // the same account without offering that legacy save to another user.
          marker = {version:1, legacyOwner:id, accounts:[], pending:{accountId:id, values}};
          await atomicWrite(markerFile, marker);
        } else if (marker.pending?.accountId === id) values = validateValues(marker.pending.values);
        else values = {};
        identity();
        await atomicWrite(file, {version:1, accountId:id, values});
      }
      marker ??= {version:1, legacyOwner:id, accounts:[]};
      marker.accounts = [...new Set([...marker.accounts,id])];
      if (marker.pending?.accountId === id) delete marker.pending;
      await atomicWrite(markerFile,marker);
      identity(); accountId=id; opened=true;
      return values;
    });
  }
  function write(input) {
    const values = validateValues(input);
    return enqueue(async()=>{
      const id=identity();
      if (!opened) throw new Error('Save is not open');
      const file=path.join(root,'saves',id,'progress.json');
      const previous=await readJson(file);
      if (!previous || previous.version!==1 || previous.accountId!==id) throw new Error('Save changed externally; restart to recover');
      validateValues(previous.values);
      await atomicWrite(file+'.bak',previous);
      identity();
      await atomicWrite(file,{version:1,accountId:id,values});
    });
  }
  return {open,write,drain:()=>queue,
    isCurrentAccount() { try { identity(); return opened; } catch { return false; } },
  };
}
module.exports={createSaveStore,saveRoot,validateValues};
