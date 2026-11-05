const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

function verifySteamPackage({ appOutDir, platform, arch, productFilename, expectedCatalog, steamBuild }) {
  const executableDir = platform === "darwin"
    ? path.join(appOutDir, `${productFilename}.app`, "Contents", "MacOS") : appOutDir;
  const resources = platform === "darwin"
    ? path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");
  const archive = path.join(resources, "app.asar");
  const entries = asar.listPackage(archive).map((entry) => entry.replaceAll("\\", "/"));
  for (const required of ["main.js", "preload.js", "steam-achievements.js", "steam-save.js", "steam-achievements/catalog.json",
    "node_modules/steamworks.js/index.js"]) {
    assert(entries.includes(`/${required}`), `Steam package missing ${required}`);
  }
  const catalog = JSON.parse(asar.extractFile(archive, path.join("steam-achievements", "catalog.json")).toString());
  assert.deepEqual(catalog, expectedCatalog, "Packaged achievement catalog differs from source catalog");
  const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString());
  assert.equal(metadata.dependencies?.["steamworks.js"], "0.4.0", "Steamworks runtime dependency is not pinned");
  assert.equal(metadata.steamBuild === true, steamBuild, "Steam build launch metadata differs from build request");

  const natives = {
    "linux-x64": ["linux64/steamworksjs.linux-x64-gnu.node", "linux64/libsteam_api.so"],
    "win32-x64": ["win64/steamworksjs.win32-x64-msvc.node", "win64/steam_api64.dll"],
    "darwin-x64": ["osx/steamworksjs.darwin-x64.node", "osx/libsteam_api.dylib"],
    "darwin-arm64": ["osx/steamworksjs.darwin-arm64.node", "osx/libsteam_api.dylib"],
  }[`${platform}-${arch}`];
  assert(natives, `No Steamworks native build for ${platform}/${arch}`);
  for (const native of natives) {
    const relative = path.join("node_modules", "steamworks.js", "dist", native);
    assert.equal(asar.statFile(archive, relative).unpacked, true, `${relative} must be unpacked`);
    assert(fs.statSync(path.join(`${archive}.unpacked`, relative)).size > 0, `Missing unpacked ${relative}`);
  }
  const redistributable = path.basename(natives[1]);
  assert(fs.statSync(path.join(executableDir, redistributable)).size > 0,
    `Missing ${redistributable} beside launch executable`);
  assert(!entries.some((entry) => path.basename(entry) === "steam_appid.txt"), "steam_appid.txt must not ship in archive");
  for (const entry of fs.readdirSync(appOutDir, { recursive: true })) {
    assert(path.basename(entry) !== "steam_appid.txt", "steam_appid.txt must not ship in depot");
  }
  return { achievements: catalog.length, platform, arch, steamBuild };
}

module.exports = async function afterPack(context) {
  const result = verifySteamPackage({
    appOutDir: context.appOutDir,
    platform: context.electronPlatformName,
    arch: ["ia32", "x64", "armv7l", "arm64", "universal"][context.arch],
    productFilename: context.packager.appInfo.productFilename,
    expectedCatalog: require("../../../store/steam/achievements/catalog.json"),
    steamBuild: context.packager.config.extraMetadata?.steamBuild === true,
  });
  console.log(`[steam-package] Verified ${result.achievements} achievements, sandbox preload, ` +
    `native binding and redistributables (${result.platform}/${result.arch}, steamBuild=${result.steamBuild}).`);
};
module.exports.verifySteamPackage = verifySteamPackage;
