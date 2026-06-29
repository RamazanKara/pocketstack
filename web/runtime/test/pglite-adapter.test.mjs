import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";

async function loadPGliteModule() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/pglite-adapter.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("PGlite adapter maps persistence labels to browser data dirs", async () => {
  const { pgliteDataDir, pgliteIndexedDBName, pglitePersists, storageToken } = await loadPGliteModule();
  assert.equal(pgliteDataDir({ name: "db", config: {} }), "idb://pocketstack-db");
  assert.equal(pgliteIndexedDBName({ name: "db" }), "pocketstack-db");
  assert.equal(
    pgliteIndexedDBName({ name: "db/main", config: { storageNamespace: "ps demo" } }),
    "pocketstack-ps-demo-db-main",
  );
  assert.equal(storageToken("demo / db"), "demo-db");
  assert.equal(pglitePersists({ name: "db", config: { persist: "indexeddb" } }), true);
  assert.equal(pgliteDataDir({ name: "db", config: { persist: "memory" } }), "memory://");
  assert.equal(pglitePersists({ name: "db", config: { persist: "memory" } }), false);
});

test("PGlite bootstrap runs SQL assets once per persisted database", async () => {
  const { ensurePGliteBootstrapped } = await loadPGliteModule();
  let bootstrapped = false;
  let assetsExecuted = 0;
  const execs = [];
  const db = {
    async exec(sql) {
      execs.push(sql);
      if (sql.includes("insert into __pocketstack_bootstrap")) bootstrapped = true;
    },
    async query(sql) {
      assert.match(sql, /__pocketstack_bootstrap/);
      return { rows: bootstrapped ? [{ value: "1" }] : [] };
    },
  };

  assert.equal(await ensurePGliteBootstrapped(db, async () => {
    assetsExecuted += 1;
  }), true);
  assert.equal(await ensurePGliteBootstrapped(db, async () => {
    assetsExecuted += 1;
  }), false);
  assert.equal(assetsExecuted, 1);
  assert.equal(execs.some((sql) => /create table if not exists __pocketstack_bootstrap/.test(sql)), true);
});
