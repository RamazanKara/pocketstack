import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

async function readManifest(t, name) {
  let raw;
  try {
    raw = await readFile(new URL(`../../../dist/${name}/pocketstack.manifest.json`, import.meta.url), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip(`run make smoke to generate dist/${name} first`);
      return null;
    }
    throw error;
  }
  return JSON.parse(raw);
}

test("generated static demo uses manifest v2", async (t) => {
  const manifest = await readManifest(t, "static-site");
  if (!manifest) return;
  assert.equal(manifest.version, "2");
  assert.equal(manifest.browserOnly, true);
  assert.match(manifest.storageNamespace, /^ps-[a-f0-9]{16}$/);
  assert.equal(manifest.services[0].adapter, "static-web");
});

test("generated adapter demos expose expected adapters", async (t) => {
  const expected = new Map([
    ["frontend", "frontend"],
    ["wasi", "wasi"],
    ["mock-api", "mock-http"],
    ["postgres-pglite", "postgres-pglite"],
    ["sqlite", "sqlite"],
  ]);
  for (const [demo, adapter] of expected) {
    const manifest = await readManifest(t, demo);
    if (!manifest) return;
    assert.equal(manifest.version, "2");
    assert.equal(manifest.browserOnly, true);
    assert.equal(manifest.services[0].adapter, adapter);
  }
});

test("generated frontend demo carries WebContainer lifecycle config", async (t) => {
  const manifest = await readManifest(t, "frontend");
  if (!manifest) return;
  const service = manifest.services[0];
  assert.equal(service.adapter, "frontend");
  assert.equal(service.config.projectPath, "assets/app/project");
  assert.equal(service.config.install, "npm install");
  assert.equal(service.config.start, "npm run dev -- --host 0.0.0.0");
  assert.equal(service.config.port, "5173");
  assert.equal(service.config.packageManager, "npm");
  assert.equal(service.config.env, "VITE_POCKETSTACK_MODE=browser");
});

test("generated mock demo packages OpenAPI and fixture assets", async (t) => {
  const manifest = await readManifest(t, "mock-api");
  if (!manifest) return;
  const service = manifest.services[0];
  assert.equal(service.adapter, "mock-http");
  assert.equal(service.config.openapiPath, "assets/api/openapi.yaml");
  assert.equal(service.config.fixturesPath, "assets/api/fixtures");
  assert.deepEqual(service.assets.map((asset) => asset.name).sort(), ["fixtures", "openapi"]);
  const fixtures = service.assets.find((asset) => asset.name === "fixtures");
  assert.equal(fixtures.kind, "json-directory");
  assert.deepEqual(fixtures.files, ["echo.json", "health.json"]);
  assert.equal(service.config.fixturesIndex, "echo.json\nhealth.json");
});

test("generated SQLite demo preserves SQL seed extension", async (t) => {
  const manifest = await readManifest(t, "sqlite");
  if (!manifest) return;
  const service = manifest.services[0];
  assert.equal(service.adapter, "sqlite");
  assert.equal(service.config.seedPath, "assets/db/seed.sql");
  assert.equal(service.config.storageNamespace, manifest.storageNamespace);
});

test("generated PGlite demo carries persistence and SQL assets", async (t) => {
  const manifest = await readManifest(t, "postgres-pglite");
  if (!manifest) return;
  const service = manifest.services[0];
  assert.equal(service.adapter, "postgres-pglite");
  assert.equal(service.config.persist, "indexeddb");
  assert.equal(service.config.initPath, "assets/db/init.sql");
  assert.equal(service.config.seedPath, "assets/db/seed.sql");
  assert.equal(service.config.storageNamespace, manifest.storageNamespace);
});

test("generated WASI demo carries args and Compose environment", async (t) => {
  const manifest = await readManifest(t, "wasi");
  if (!manifest) return;
  const service = manifest.services[0];
  assert.equal(service.adapter, "wasi");
  assert.equal(service.config.args, "--name PocketStack");
  assert.equal(service.config.env, "POCKETSTACK_MODE=demo");
  assert.equal(manifest.hostRequirements.crossOriginIsolationRequired, true);
  assert.equal(service.hostRequirements.crossOriginIsolationRequired, true);
  const headers = await readFile(new URL("../../../dist/wasi/_headers", import.meta.url), "utf8");
  assert.match(headers, /Cross-Origin-Opener-Policy: same-origin/);
  assert.match(headers, /Cross-Origin-Embedder-Policy: require-corp/);
  const vercel = JSON.parse(await readFile(new URL("../../../dist/wasi/vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(vercel.headers[0].headers, [
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  ]);
  const staticWebApp = JSON.parse(await readFile(new URL("../../../dist/wasi/staticwebapp.config.json", import.meta.url), "utf8"));
  assert.equal(staticWebApp.globalHeaders["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(staticWebApp.globalHeaders["Cross-Origin-Embedder-Policy"], "require-corp");
});

test("generated full-stack demo wires frontend bridge, mock API, and browser database", async (t) => {
  const manifest = await readManifest(t, "full-stack");
  if (!manifest) return;
  const byName = Object.fromEntries(manifest.services.map((service) => [service.name, service]));

  assert.equal(byName.app.adapter, "frontend");
  assert.equal(byName.api.adapter, "mock-http");
  assert.equal(byName.db.adapter, "postgres-pglite");
  assert.equal(byName.app.config.env, "VITE_API_URL=http://api:8080");
  assert.equal(byName.app.config.projectPath, "assets/app/project");
  assert.equal(byName.api.config.fixturesIndex, "health.json");
  assert.equal(byName.db.config.initScripts, "assets/db/init-scripts/01-init.sql");

  const index = await readFile(new URL("../../../dist/full-stack/assets/app/project/index.html", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../../../dist/full-stack/app.js", import.meta.url), "utf8");
  assert.match(index, /src="\/src\/main\.jsx"/);
  assert.match(runtime, /__POCKETSTACK_BRIDGE_CONFIG__/);
  assert.match(runtime, /__pocketstack_bridge\.js/);
  assert.match(runtime, /POCKETSTACK_BRIDGE_FETCH/);
  assert.match(runtime, /window\.fetch/);
});

test("generated upload-ready examples are real browser-native demos", async (t) => {
  const expected = new Map([
    ["uploaded-static-blog", "static-web"],
    ["uploaded-mock-catalog", "mock-http"],
    ["uploaded-sqlite-notes", "sqlite"],
  ]);
  for (const [demo, adapter] of expected) {
    const manifest = await readManifest(t, demo);
    if (!manifest) return;
    assert.equal(manifest.version, "2");
    assert.equal(manifest.browserOnly, true);
    assert.equal(manifest.services[0].adapter, adapter);
  }

  const staticHTML = await readFile(new URL("../../../dist/uploaded-static-blog/assets/web/static/index.html", import.meta.url), "utf8");
  assert.match(staticHTML, /href="\.\/styles\.css"/);

  const mock = await readManifest(t, "uploaded-mock-catalog");
  assert.equal(mock.services[0].config.fixturesIndex, "products-demo.json\nsearch.json");

  const sqlite = await readManifest(t, "uploaded-sqlite-notes");
  assert.equal(sqlite.services[0].config.persist, "memory");
  assert.equal(sqlite.services[0].config.initPath, "assets/db/init.sql");
  assert.equal(sqlite.services[0].config.seedPath, "assets/db/seed.sql");
});
