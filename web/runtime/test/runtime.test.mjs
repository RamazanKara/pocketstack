import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

test("runtime script exposes adapter handlers", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/app.js", import.meta.url), "utf8");
  for (const adapter of ["frontend", "wasi", "mock-http", "postgres-pglite", "sqlite", "static-web"]) {
    assert.match(source, new RegExp(adapter.replace("-", "\\-")));
  }
});

test("runtime script includes real WASI fallback execution", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/app.js", import.meta.url), "utf8");
  assert.match(source, /runWasix/);
  assert.match(source, /@wasmer\/sdk@0\.10\.0/);
  assert.match(source, /wasi_unstable/);
});

test("runtime script remains a browser module", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/app.js", import.meta.url), "utf8");
  assert.match(source, /export\s*\{/);
  assert.match(source, /pocketstack\.manifest\.json/);
});

test("runtime script exposes browser database query bridge", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/app.js", import.meta.url), "utf8");
  assert.match(source, /POCKETSTACK_DB_QUERY/);
  assert.match(source, /__pocketstack\/db/);
  assert.match(source, /globalThis\.PocketStack/);
});

test("runtime script exposes WebContainer frontend bridge", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/app.js", import.meta.url), "utf8");
  assert.match(source, /POCKETSTACK_BRIDGE_FETCH/);
  assert.match(source, /__pocketstack_bridge\.js/);
  assert.match(source, /frontendBridgeTargetURL/);
});

test("runtime script surfaces service compatibility warnings", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/app.js", import.meta.url), "utf8");
  assert.match(source, /logServiceWarnings/);
  assert.match(source, /COOP\/COEP required/);
  assert.match(source, /public browser runtime packages or npm dependencies/);
});

test("runtime escapes untrusted values and pins CDN runtime packages", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/app.js", import.meta.url), "utf8");
  // Untrusted Compose/OpenAPI strings must be escaped before innerHTML.
  assert.match(source, /escapeHTML/);
  // Browser runtime packages must be version-pinned, not floating on latest.
  assert.match(source, /@webcontainer\/api@\d/);
  assert.match(source, /@electric-sql\/pglite@\d/);
});

test("mock OpenAPI YAML parser is bundled into generated demos", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /esm\.sh\/js-yaml/);
  assert.match(source, /js-yaml 4\./);
});

test("mock service worker handles demos hosted below a path prefix", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/mock-sw.js", import.meta.url), "utf8");
  assert.match(source, /indexOf\(marker\)/);
  assert.match(source, /decodeURIComponent\(service\)/);
  assert.match(source, /clients\.claim/);
});

test("mock service worker supports OpenAPI path templates", async () => {
  const source = await readFile(new URL("../../../internal/generator/runtime/mock-sw.js", import.meta.url), "utf8");
  assert.match(source, /matchRoute/);
  assert.match(source, /params\[parameter\[1\]\]/);
  assert.match(source, /\^\\\{\(\[\^\/\]\+\)\\\}\$/);
});
