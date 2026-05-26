import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

test("runtime script exposes adapter handlers", async () => {
  const source = await readFile(new URL("../../internal/staticdemo/runtime/app.js", import.meta.url), "utf8");
  for (const adapter of ["frontend", "wasi", "mock-http", "postgres-pglite", "sqlite", "static-web"]) {
    assert.match(source, new RegExp(adapter.replace("-", "\\-")));
  }
});

test("runtime script remains a browser module", async () => {
  const source = await readFile(new URL("../../internal/staticdemo/runtime/app.js", import.meta.url), "utf8");
  assert.match(source, /export\s*\{/);
  assert.match(source, /pocketstack\.manifest\.json/);
});

test("mock service worker handles demos hosted below a path prefix", async () => {
  const source = await readFile(new URL("../../internal/staticdemo/runtime/mock-sw.js", import.meta.url), "utf8");
  assert.match(source, /indexOf\(marker\)/);
  assert.match(source, /decodeURIComponent\(service\)/);
  assert.match(source, /clients\.claim/);
});
