#!/usr/bin/env node
/**
 * Cross-platform Gradle wrapper launcher.
 *
 * `cd android && ./gradlew …` works on macOS and Linux and fails on Windows
 * with "'.' is not recognized as an internal or external command" — cmd.exe
 * can't execute a POSIX-style relative path, and the wrapper it needs is the
 * separate gradlew.bat. Node knows which platform it's on, so it picks.
 *
 *   node scripts/gradle.mjs assembleDebug
 */
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(appDir, "android");

const wrapper = process.platform === "win32"
  ? path.join(androidDir, "gradlew.bat")
  : path.join(androidDir, "gradlew");

const child = spawn(wrapper, process.argv.slice(2), {
  cwd: androidDir,
  stdio: "inherit",
  // Windows resolves .bat through the shell; POSIX must not use one, so an
  // argument containing spaces can't be re-split.
  shell: process.platform === "win32",
});

child.on("error", (err) => {
  console.error(`gradle: could not run ${wrapper}: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
