import assert from "node:assert/strict";
import { resolveApiBase } from "../src/lib/api-origin";
import { apiBase } from "../src/lib/api";

Object.defineProperty(globalThis, "location", { value: { hostname: "localhost", protocol: "http:" }, configurable: true });
assert.equal(apiBase(), "", "local web requests stay same-origin instead of posting production scores");

for (const protocol of ["http:", "https:"]) {
  assert.equal(resolveApiBase(protocol, false), "", "every browser host stays same-origin");
}
assert.equal(resolveApiBase("https:", true), "https://tetrilaunch.com", "installed mobile release keeps its board");
assert.equal(resolveApiBase("app:", false), "https://tetrilaunch.com", "installed desktop keeps its board");
for (const native of [false, true]) {
  assert.equal(resolveApiBase("https:", native, " https://staging.example/ "), "https://staging.example");
  assert.equal(resolveApiBase("app:", native, "http://127.0.0.1:8787"), "http://127.0.0.1:8787");
}
for (const invalid of ["/api", "javascript:alert(1)", "https://user:password@example.com", "https://example.com/path", "https://example.com?key=x", "https://example.com#x"]) {
  assert.throws(() => resolveApiBase("https:", false, invalid), "invalid configuration must fail closed");
}

console.log("API safety checks passed.");
