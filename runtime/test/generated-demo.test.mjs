import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

test("generated static demo uses manifest v2", async (t) => {
  let raw;
  try {
    raw = await readFile(new URL("../../dist/static-site/pocketstack.manifest.json", import.meta.url), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("run make smoke to generate dist/static-site first");
      return;
    }
    throw error;
  }
  const manifest = JSON.parse(raw);
  assert.equal(manifest.version, "2");
  assert.equal(manifest.browserOnly, true);
  assert.equal(manifest.services[0].adapter, "static-web");
});
