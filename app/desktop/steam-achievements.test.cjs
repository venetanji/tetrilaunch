const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const { createSteamAchievements } = require("./steam-achievements.js");

const catalog = [{ apiName: "FIRST_CONTRACT" }, { apiName: "SYSTEMS_HALF" }];

function sender(url = "app://tetrilaunch/index.html") {
  const mainFrame = { url };
  return { sender: { mainFrame }, senderFrame: mainFrame };
}

function fixture(overrides = {}) {
  const achieved = new Set();
  const calls = [];
  const client = {
    achievement: {
      isActivated(id) { calls.push(["read", id]); return achieved.has(id); },
      activate(id) { calls.push(["activate", id]); achieved.add(id); return true; },
    },
    stats: { store() { calls.push(["store"]); return true; } },
  };
  const native = {
    init(appId) { calls.push(["init", appId]); return client; },
    restartAppIfNecessary(appId) { calls.push(["restart", appId]); return true; },
  };
  const bridge = createSteamAchievements({ catalog, loadSteamworks: () => native, ...overrides });
  return { bridge, native, client, calls, achieved };
}

test("accepted activation reads Steam state and does not activate an earned ID twice", async () => {
  const { bridge, calls } = fixture();
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), true);
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), true);
  assert.deepEqual(calls, [
    ["init", 5270760], ["read", "FIRST_CONTRACT"], ["activate", "FIRST_CONTRACT"],
    ["read", "FIRST_CONTRACT"], ["read", "FIRST_CONTRACT"],
  ]);
});

test("untrusted frames and unknown IDs never reach the native SDK", async () => {
  const { bridge, calls } = fixture();
  const iframe = sender();
  iframe.senderFrame = { url: "app://tetrilaunch/iframe.html" };
  for (const event of [iframe, sender("https://tetrilaunch.com/"), sender("app://evil/"),
    sender("app://tetrilaunch.evil/"), sender("app://user@tetrilaunch/"), sender("app://tetrilaunch:12/")]) {
    assert.equal(await bridge.unlockAchievement(event, "FIRST_CONTRACT"), false);
  }
  for (const id of ["EXAMPLE", "FIRST_CONTRACT ", null, {}, ["FIRST_CONTRACT"]]) {
    assert.equal(await bridge.unlockAchievement(sender(), id), false);
  }
  assert.deepEqual(calls, []);
});

test("a missing Steam client can initialize on a later retry without restarting the game", async () => {
  let now = 1000;
  let attempts = 0;
  const { bridge, native, calls } = fixture({ now: () => now });
  const initialize = native.init;
  native.init = (id) => { if (++attempts === 1) throw new Error("Steam unavailable"); return initialize(id); };
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  assert.equal(attempts, 1);
  now += 30000;
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), true);
  assert.equal(attempts, 2);
  assert.equal(calls.some(([action]) => action === "restart"), false);
});

test("a binding load failure returns false and is retried after the cooldown", async () => {
  let now = 0;
  let loads = 0;
  const { native } = fixture();
  const bridge = createSteamAchievements({ catalog, now: () => now,
    loadSteamworks() { if (++loads === 1) throw new Error("Missing .node"); return native; } });
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  now = 30000;
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), true);
  assert.equal(loads, 2);
});

test("stats not ready returns false then succeeds through the same initialized client", async () => {
  const { bridge, client, achieved, calls } = fixture();
  client.achievement.activate = () => false;
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  client.achievement.activate = (id) => { achieved.add(id); return true; };
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), true);
  assert.equal(calls.filter(([action]) => action === "init").length, 1);
});

test("a locally set achievement whose StoreStats failed is not acknowledged until store succeeds", async () => {
  const { bridge, client, achieved } = fixture();
  client.achievement.activate = (id) => { achieved.add(id); return false; };
  client.stats.store = () => false;
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  client.stats.store = () => true;
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), true);
});

test("a native failure cannot acknowledge success and does not prevent a later retry", async () => {
  const { bridge, client, achieved } = fixture();
  client.achievement.activate = (id) => { achieved.add(id); throw new Error("Store failure"); };
  client.stats.store = () => false;
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  client.stats.store = () => true;
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), true);
});

test("truthy non-booleans and unconfirmed local state never acknowledge activation", async () => {
  const { bridge, client } = fixture();
  client.achievement.activate = () => "yes";
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
  client.achievement.activate = () => true;
  assert.equal(await bridge.unlockAchievement(sender(), "FIRST_CONTRACT"), false);
});

test("Steam restart is explicit and a missing client never prevents standalone startup", () => {
  const { bridge, calls } = fixture();
  assert.deepEqual(calls, []);
  assert.equal(bridge.restartIfNecessary(), true);
  assert.deepEqual(calls, [["restart", 5270760]]);
  const absent = createSteamAchievements({ catalog, loadSteamworks() { throw new Error("Absent"); } });
  assert.equal(absent.restartIfNecessary(), false);
  assert.equal(absent.initialize(), false);
});

test("sandbox-compatible preload exposes one async boolean API and handles rejected IPC", async () => {
  let exposed;
  let invokeResult = true;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(require.resolve("./preload.js"), "utf8"), {
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "steam"); exposed = value; } },
        ipcRenderer: { async invoke(...args) { calls.push(args); if (invokeResult instanceof Error) throw invokeResult; return invokeResult; } },
      };
    },
  });
  assert.deepEqual(Object.keys(exposed), ["unlockAchievement"]);
  assert.equal(await exposed.unlockAchievement("FIRST_CONTRACT"), true);
  assert.deepEqual(calls, [["steam:unlock-achievement", "FIRST_CONTRACT"]]);
  invokeResult = "true";
  assert.equal(await exposed.unlockAchievement("FIRST_CONTRACT"), false);
  invokeResult = new Error("IPC shutdown");
  assert.equal(await exposed.unlockAchievement("FIRST_CONTRACT"), false);
});
