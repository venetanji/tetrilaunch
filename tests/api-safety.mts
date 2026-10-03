import assert from "node:assert/strict";
import worker from "../app/worker/index";

// A rejected payload must never reach storage (or any external service).
const env = {
  DB: { prepare() { throw new Error("invalid payload reached D1"); } },
} as unknown as Parameters<typeof worker.fetch>[1];
const malformed = [
  "null", "[]", '"name"', "42", "true", "{", "",
  JSON.stringify({ name: { toString: null }, score: 20 }),
  JSON.stringify({ score: { toString: null } }),
  JSON.stringify({ score: 20, mark: [] }),
  JSON.stringify({ score: 20, day: null }),
];
for (const route of ["scores", "daily"]) {
  for (const body of malformed) {
    const response = await worker.fetch(new Request(`https://test.invalid/api/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }), env);
    assert.equal(response.status, 400, `${route} rejects ${JSON.stringify(body)}`);
    assert.match(response.headers.get("Content-Type") ?? "", /application\/json/);
  }
}
console.log("Worker payload checks passed.");
