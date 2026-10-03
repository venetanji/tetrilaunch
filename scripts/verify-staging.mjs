// Run after the staging deploy and secret upload. Verify the served build, not
// just Wrangler's upload response; this never writes a valid score or account.
import assert from 'node:assert/strict';
const [origin, commit] = process.argv.slice(2);
assert(origin && commit, 'usage: node scripts/verify-staging.mjs <origin> <commit>');
const base = new URL(origin);
assert(base.hostname.startsWith('tetrilaunch-staging.') || ['localhost', '127.0.0.1'].includes(base.hostname),
  'deployment smoke checks are restricted to staging or local development');
const get = async (path, init = {}) => {
  const response = await fetch(new URL(path, base), { cache: 'no-store', signal: AbortSignal.timeout(15000), ...init });
  return response;
};
async function verify() {
  const htmlResponse = await get(`/?verify=${commit}`);
  assert.equal(htmlResponse.status, 200, 'staging serves the app');
  const html = await htmlResponse.text();
  const entry = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/);
  assert(entry, 'HTML contains the built module entry');
  const bundle = await get(entry[1]);
  assert.equal(bundle.status, 200, 'entry bundle is reachable');
  assert((await bundle.text()).includes(commit.slice(0, 7)), 'served game contains the deployed commit build ID');
  const scores = await get('/api/scores?mark=1&limit=1');
  assert.equal(scores.status, 200, 'staging D1 leaderboard is readable');
  assert(Array.isArray((await scores.json()).scores), 'leaderboard returns JSON scores');
  for (const route of ['scores', 'daily']) {
    const response = await get(`/api/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null',
    });
    assert.equal(response.status, 400, `${route} rejects null without writing`);
    assert.equal((await response.json()).error, 'invalid_payload');
  }
}
for (let attempt = 1; ; attempt++) {
  try { await verify(); break; }
  catch (error) {
    if (attempt === 5) throw error;
    console.log(`Staging not ready (${attempt}/5): ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
console.log(`Verified staging build ${commit}: ${base.origin}`);
