const STEAM_APP_ID = 5270760;
const UNLOCK_CHANNEL = "steam:unlock-achievement";

function isTrustedSender(event) {
  if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === "app:" && url.hostname === "tetrilaunch" &&
      !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function createSteamAchievements({
  catalog,
  loadSteamworks = () => require("steamworks.js"),
  now = Date.now,
  reportError = () => {},
}) {
  const allowedIds = new Set(catalog.map(({ apiName }) => apiName));
  const pendingStores = new Set();
  let steamworks;
  let client;
  let retryAt = 0;

  function binding() {
    return steamworks ??= loadSteamworks();
  }

  function initialize() {
    if (client) return true;
    if (now() < retryAt) return false;
    retryAt = now() + 30000;
    try {
      // The package requests current stats and pumps callbacks at 30 Hz.
      client = binding().init(STEAM_APP_ID);
      return !!client;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  return {
    initialize,
    getAccountId() {
      if (!initialize()) return null;
      try {
        const id = client.localplayer.getSteamId().steamId64;
        return typeof id === "bigint" ? id.toString() : null;
      } catch { return null; }
    },
    restartIfNecessary() {
      try {
        return binding().restartAppIfNecessary(STEAM_APP_ID) === true;
      } catch (error) {
        reportError(error);
        return false;
      }
    },
    async unlockAchievement(event, apiName) {
      if (!isTrustedSender(event) || typeof apiName !== "string" || !allowedIds.has(apiName)) return false;
      if (!initialize()) return false;
      try {
        if (client.achievement.isActivated(apiName) === true) {
          // SetAchievement can succeed before StoreStats fails. A later read
          // sees that local bit, so retry the store before acknowledging it.
          if (pendingStores.has(apiName) && client.stats.store() !== true) return false;
          pendingStores.delete(apiName);
          return true;
        }
        pendingStores.add(apiName);
        // steamworks.js activate() already calls StoreStats. Its true result
        // confirms SDK acceptance, not a server-side UserStatsStored callback.
        if (client.achievement.activate(apiName) !== true ||
          client.achievement.isActivated(apiName) !== true) return false;
        pendingStores.delete(apiName);
        return true;
      } catch (error) {
        reportError(error);
        return false;
      }
    },
  };
}

module.exports = { createSteamAchievements, STEAM_APP_ID, UNLOCK_CHANNEL, isTrustedSender };
