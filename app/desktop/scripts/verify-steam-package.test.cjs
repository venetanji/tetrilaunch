const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const asar = require("@electron/asar");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const yaml = require("js-yaml");
const { verifySteamPackage } = require("./verify-steam-package.cjs");

test("configured file collection includes only the achievement catalog at its packaged path", async (t) => {
  const { getFileMatchers } = require("app-builder-lib/out/fileMatcher");
  const { computeFileSets, getDestinationPath } = require("app-builder-lib/out/util/appFileCopier");
  const desktopDir = path.resolve(__dirname, "..");
  const config = yaml.load(await fs.readFile(path.join(desktopDir, "electron-builder.yml"), "utf8"));
  const catalogMapping = config.files.find((entry) => typeof entry === "object" &&
    entry.from.includes("store/steam/achievements"));
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), "tetrilaunch-catalog-mapping-"));
  t.after(() => fs.rm(destination, { recursive: true, force: true }));
  const matchers = getFileMatchers({ files: [catalogMapping] }, "files", destination, {
    defaultSrc: desktopDir, macroExpander: (value) => value, customBuildOptions: {}, globalOutDir: destination,
  });
  const fileSets = await computeFileSets(matchers, null, { info: { areNodeModulesHandledExternally: true } }, false);
  const collected = fileSets.flatMap((fileSet) => fileSet.files.map((file) =>
    path.relative(destination, getDestinationPath(file, fileSet)).split(path.sep).join("/")));
  assert.deepEqual(collected, ["steam-achievements/catalog.json"]);
});

async function packaged(t, change = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tetrilaunch-steam-package-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const output = path.join(root, "linux-unpacked");
  const resources = path.join(output, "resources");
  const catalog = [{ apiName: "FIRST_CONTRACT", name: "First Contract" }];
  const files = {
    "main.js": "require('./steam-achievements.js')",
    "preload.js": "sandboxed preload",
    "steam-achievements.js": "main-process bridge",
    "steam-save.js": "account save storage",
    "steam-achievements/catalog.json": JSON.stringify(change.catalog ?? catalog),
    "package.json": JSON.stringify({ dependencies: { "steamworks.js": "0.4.0" }, steamBuild: true }),
    "node_modules/steamworks.js/index.js": "native loader",
    "node_modules/steamworks.js/dist/linux64/steamworksjs.linux-x64-gnu.node": "native module",
    "node_modules/steamworks.js/dist/linux64/libsteam_api.so": "redistributable",
    ...change.files,
  };
  if (change.omit) delete files[change.omit];
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(source, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await fs.mkdir(resources, { recursive: true });
  await asar.createPackageWithOptions(source, path.join(resources, "app.asar"), {
    unpack: "**/steamworks.js/dist/**/*",
  });
  await fs.writeFile(path.join(output, "libsteam_api.so"), "redistributable");
  const options = {
    appOutDir: output, platform: "linux", arch: "x64", productFilename: "Tetrilaunch",
    expectedCatalog: catalog, steamBuild: true,
  };
  return { output, resources, catalog, options, verify: () => verifySteamPackage(options) };
}

test("packaged bridge verifies actual archived payload and unpacked native dependencies", async (t) => {
  const built = await packaged(t);
  assert.deepEqual(built.verify(), { achievements: 1, platform: "linux", arch: "x64", steamBuild: true });
});

test("packaged bridge rejects an omitted native redistributable", async (t) => {
  const built = await packaged(t);
  await fs.unlink(path.join(built.resources, "app.asar.unpacked/node_modules/steamworks.js/dist/linux64/libsteam_api.so"));
  assert.throws(built.verify, /libsteam_api\.so/);
});

test("packaged bridge rejects stale or missing allowlist rows", async (t) => {
  const built = await packaged(t, { catalog: [{ apiName: "EXAMPLE" }] });
  assert.throws(built.verify, /catalog/);
});

test("packaged bridge rejects steam_appid.txt inside the archive or beside the executable", async (t) => {
  const archived = await packaged(t, { files: { "steam_appid.txt": "5270760" } });
  assert.throws(archived.verify, /steam_appid\.txt/);
  const loose = await packaged(t);
  await fs.writeFile(path.join(loose.output, "steam_appid.txt"), "5270760");
  assert.throws(loose.verify, /steam_appid\.txt/);
});

async function useWindowsAsar(t) {
  const filename = require.resolve("@electron/asar/lib/filesystem");
  const moduleRequire = createRequire(filename);
  const moduleExports = {};
  vm.runInNewContext(await fs.readFile(filename, "utf8"), {
    exports: moduleExports, Buffer,
    require: (name) => name === "path" ? path.win32 : moduleRequire(name),
  }, { filename });
  const filesystemFor = (archive) => {
    const filesystem = Object.create(moduleExports.Filesystem.prototype);
    filesystem.header = asar.getRawHeader(archive).header;
    return filesystem;
  };
  t.mock.method(asar, "listPackage", (archive) => filesystemFor(archive).listFiles());
  t.mock.method(asar, "statFile", (archive, member) => filesystemFor(archive).getFile(member));
  const extractFile = asar.extractFile;
  t.mock.method(asar, "extractFile", (archive, member) => {
    filesystemFor(archive).getFile(member);
    return extractFile(archive, member.replaceAll("\\", "/"));
  });

  // Use Windows member paths while mapping absolute temp paths to this host.
  const windowsPath = {
    ...path.win32,
    join(...parts) {
      const joined = path.win32.join(...parts);
      return path.posix.isAbsolute(parts[0]) ? joined.replaceAll("\\", "/") : joined;
    },
  };
  const verifierFilename = require.resolve("./verify-steam-package.cjs");
  const verifierModule = { exports: {} };
  const verifierRequire = createRequire(verifierFilename);
  vm.runInNewContext(await fs.readFile(verifierFilename, "utf8"), {
    module: verifierModule, console, JSON, __dirname,
    require: (name) => name === "node:path" ? windowsPath : verifierRequire(name),
  }, { filename: verifierFilename });
  return verifierModule.exports.verifySteamPackage;
}

test("packaged bridge accepts Windows ASAR listings and nested native member lookups", async (t) => {
  const built = await packaged(t);
  const verifyWindows = await useWindowsAsar(t);
  assert.deepEqual({ ...verifyWindows(built.options) }, { achievements: 1, platform: "linux", arch: "x64", steamBuild: true });
});

test("Windows ASAR listings still reject missing required files", async (t) => {
  const verifyWindows = await useWindowsAsar(t);
  for (const missing of ["main.js", "preload.js", "steam-achievements/catalog.json"]) {
    const built = await packaged(t, { omit: missing });
    assert.throws(() => verifyWindows(built.options), (error) => error.message === `Steam package missing ${missing}`);
  }
});

test("Windows ASAR listings still reject a nested steam_appid.txt", async (t) => {
  const built = await packaged(t, { files: { "nested/steam_appid.txt": "5270760" } });
  const verifyWindows = await useWindowsAsar(t);
  assert.throws(() => verifyWindows(built.options), /steam_appid\.txt must not ship in archive/);
});

test("Windows ASAR member lookups still reject missing unpacked native libraries", async (t) => {
  const built = await packaged(t);
  const verifyWindows = await useWindowsAsar(t);
  await fs.unlink(path.join(built.resources, "app.asar.unpacked/node_modules/steamworks.js/dist/linux64/libsteam_api.so"));
  assert.throws(() => verifyWindows(built.options), /libsteam_api\.so/);
});

test("workflow only marks explicit Steam uploads and preserves all macOS signing arguments", async (t) => {
  const workflow = yaml.load(await fs.readFile(path.resolve(__dirname, "../../../.github/workflows/desktop.yml"), "utf8"));
  const scenarios = [
    { event: "workflow_dispatch", upload: true, steam: true },
    { event: "workflow_dispatch", upload: false, steam: false },
    { event: "push", upload: true, steam: false },
    { event: "release", upload: true, steam: false },
  ];
  for (const script of ["dist:win", "dist:linux", "dist:mac"]) {
    for (const scenario of scenarios) {
      await t.test(`${script} ${scenario.event} steam_upload=${scenario.upload}`, async (subtest) => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "tetrilaunch-workflow-"));
        subtest.after(() => fs.rm(root, { recursive: true, force: true }));
        const binaryDir = path.join(root, "bin");
        const argsFile = path.join(root, "npm-args.json");
        await fs.mkdir(binaryDir);
        await fs.writeFile(path.join(binaryDir, "npm"),
          "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.PACKAGE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\n",
          { mode: 0o755 });
        const secrets = {
          MACOS_CERTIFICATE: "fixture-certificate", MACOS_CERTIFICATE_PASSWORD: "fixture-password",
          MACOS_SIGNING_IDENTITY: "Fixture Identity", ASC_API_KEY_P8: "Zml4dHVyZQ==",
          ASC_API_KEY_ID: "fixture-key-id", ASC_API_ISSUER_ID: "fixture-issuer",
        };
        const context = { github: { event_name: scenario.event }, inputs: { steam_upload: scenario.upload },
          matrix: { script }, secrets };
        const expand = (value) => value.replace(/\$\{\{\s*(.*?)\s*\}\}/g,
          (_, expression) => String(vm.runInNewContext(expression, context)));
        const step = workflow.jobs.package.steps.find(({ name }) => name ===
          (script === "dist:mac" ? "Package, sign and notarize macOS" : "Package Windows or Linux"));
        const interpreter = step.shell ?? (script === "dist:win" ? "pwsh" : "bash");
        const result = spawnSync(interpreter, ["-c", expand(step.run)], {
          cwd: root, encoding: "utf8",
          env: { ...process.env, ...Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, expand(value)])),
            PATH: binaryDir + path.delimiter + process.env.PATH, RUNNER_TEMP: root, PACKAGE_ARGS_FILE: argsFile },
        });
        assert.equal(result.status, 0, result.stderr);
        const expected = script === "dist:mac" ? ["run", "dist:mac", "--",
          "--config.mac.identity=Fixture Identity", "--config.mac.hardenedRuntime=true",
          "--config.mac.notarize=true", "--config.dmg.sign=true"] : ["run", script];
        if (scenario.steam) {
          if (script !== "dist:mac") expected.push("--");
          expected.push("--config", "electron-builder.steam.yml");
        }
        assert.deepEqual(JSON.parse(await fs.readFile(argsFile, "utf8")), expected);
      });
    }
  }
});
test('packaged payload rejects omitted Auto-Cloud save implementation',async t=>{
 const built=await packaged(t,{omit:'steam-save.js'});
 assert.throws(built.verify,/steam-save/);
});
