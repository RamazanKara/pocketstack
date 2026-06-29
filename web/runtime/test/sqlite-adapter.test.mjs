import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";

async function loadSQLiteModule() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/sqlite-adapter.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("SQLite adapter recognizes seed database files", async () => {
  const { isSQLiteDatabasePath } = await loadSQLiteModule();
  assert.equal(isSQLiteDatabasePath("seed.db"), true);
  assert.equal(isSQLiteDatabasePath("seed.sqlite"), true);
  assert.equal(isSQLiteDatabasePath("seed.sqlite3"), true);
  assert.equal(isSQLiteDatabasePath("seed.sql"), false);
});

test("SQLite adapter defaults to IndexedDB persistence", async () => {
  const { sqlitePersists, sqliteStorageKey, storageToken } = await loadSQLiteModule();
  assert.equal(sqlitePersists({ name: "db", config: {} }), true);
  assert.equal(sqlitePersists({ name: "db", config: { persist: "indexeddb" } }), true);
  assert.equal(sqlitePersists({ name: "db", config: { persist: "memory" } }), false);
  assert.equal(sqliteStorageKey({ name: "db" }), "pocketstack:sqlite:db");
  assert.equal(
    sqliteStorageKey({ name: "db/main", config: { storageNamespace: "ps demo" } }),
    "pocketstack:sqlite:ps-demo:db-main",
  );
  assert.equal(storageToken("demo / db"), "demo-db");
});
