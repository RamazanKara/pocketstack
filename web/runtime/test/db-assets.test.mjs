import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import test from "node:test";

async function loadDBAssetsModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/db-assets.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

test("database SQL asset paths preserve init, mounted scripts, and seed order", async () => {
  const { configList, databaseSQLAssetPaths, sqliteSQLAssetPaths } = await loadDBAssetsModule();
  assert.deepEqual(configList(" a.sql\n\n b.sql "), ["a.sql", "b.sql"]);
  assert.deepEqual(
    databaseSQLAssetPaths({
      config: {
        initPath: "assets/db/init.sql",
        initScripts: "assets/db/init-scripts/01-schema.sql\nassets/db/init-scripts/02-data.sql",
        seedPath: "assets/db/seed.sql",
        seedScripts: "assets/db/seed-scripts/03-extra.sql",
      },
    }),
    [
      "assets/db/init.sql",
      "assets/db/init-scripts/01-schema.sql",
      "assets/db/init-scripts/02-data.sql",
      "assets/db/seed.sql",
      "assets/db/seed-scripts/03-extra.sql",
    ],
  );
  assert.deepEqual(
    sqliteSQLAssetPaths(
      {
        config: {
          initPath: "assets/db/init.sql",
          initScripts: "assets/db/init-scripts/01-schema.sql",
          seedPath: "assets/db/seed.sqlite3",
          seedScripts: "assets/db/seed-scripts/02-seed.sql",
        },
      },
      (path) => path.endsWith(".sqlite3"),
    ),
    [
      "assets/db/init.sql",
      "assets/db/init-scripts/01-schema.sql",
      "assets/db/seed-scripts/02-seed.sql",
    ],
  );
});
