import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

async function readManifest(t, name) {
  let raw;
  try {
    raw = await readFile(new URL(`../../dist/${name}/pocketstack.manifest.json`, import.meta.url), "utf8");
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
