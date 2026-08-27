// Asserts that the desktop package's version matches app/package.json's, and —
// when RELEASE_TAG is set — that a v* tag matches both.
//
// WHY THE TAG IS CHECKED RATHER THAN WRITTEN IN. Deriving the version from the
// tag at build time is the cheaper option and it is the wrong one here, because
// electron-builder does not merely name files with it. The number is baked into
// the NSIS uninstall entry Windows reads to decide whether an install is an
// upgrade, into CFBundleShortVersionString in the macOS Info.plist, and into
// the AppImage's embedded desktop entry. If the tag wrote those and the
// committed package.json said something else, the repo and the shipped app
// would disagree about what 1.2.3 is, and the disagreement would surface much
// later — as a failed upgrade, or as an auto-updater comparing the wrong pair
// of numbers. So the version is committed, the tag has to agree with it, and a
// mismatch fails before anything is packaged.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = async (p) => JSON.parse(await readFile(resolve(HERE, "..", p), "utf8"));

const desktop = await read("package.json");
const app = await read("../package.json");

const fail = (message) => {
  // GitHub Actions renders this as an annotation on the run; a plain shell
  // shows it as an ordinary line. Both read fine.
  console.error(`::error::${message}`);
  process.exit(1);
};

if (desktop.version !== app.version) {
  fail(
    `desktop/package.json is ${desktop.version} but app/package.json is ${app.version}. ` +
      `They ship as one product — bump both.`,
  );
}

const tag = process.env.RELEASE_TAG;
if (tag) {
  const expected = `v${app.version}`;
  if (tag !== expected) {
    fail(
      `tag ${tag} does not match the committed version ${app.version} (expected ${expected}). ` +
        `Bump app/package.json and desktop/package.json, commit, then re-tag.`,
    );
  }
  console.log(`version ${app.version} matches tag ${tag}`);
} else {
  console.log(`version ${app.version} (app and desktop agree)`);
}
