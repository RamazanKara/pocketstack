import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";

async function loadServiceURLHelpers() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/service-urls.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("frontend service env injects and rewrites mock HTTP service URLs", async () => {
  const {
    databaseServiceBaseURL,
    frontendBridgeNeeded,
    frontendServiceEnvironment,
    mockServiceBaseURL,
    rewriteMockServiceURL,
    serviceEnvName,
  } = await loadServiceURLHelpers();
  const services = [
    { name: "api", adapter: "mock-http", publicPort: 8080 },
    { name: "admin-api", adapter: "mock-http", publicPort: 9000 },
    { name: "db", adapter: "postgres-pglite", publicPort: 5432 },
  ];
  const base = "https://demo.test/pocketstack/index.html";

  assert.equal(serviceEnvName("admin-api"), "ADMIN_API");
  assert.equal(frontendBridgeNeeded(services), true);
  assert.equal(mockServiceBaseURL(services[0], base), "https://demo.test/pocketstack/__pocketstack/mock/api");
  assert.equal(databaseServiceBaseURL(services[2], base), "https://demo.test/pocketstack/__pocketstack/db/db");
  assert.equal(
    rewriteMockServiceURL("http://api:8080/v1/users?active=1#top", services, base),
    "https://demo.test/pocketstack/__pocketstack/mock/api/v1/users?active=1#top",
  );
  assert.equal(rewriteMockServiceURL("postgres://db:5432/app", services, base), "postgres://db:5432/app");
  assert.equal(rewriteMockServiceURL("http://api:9000/v1", services, base), "http://api:9000/v1");

  const env = frontendServiceEnvironment({
    VITE_API_URL: "http://api:8080",
    VITE_ADMIN_URL: "https://admin-api:9000/admin",
    VITE_POCKETSTACK_API_URL: "https://custom.test/api",
  }, services, base);

  assert.equal(env.VITE_API_URL, "https://demo.test/pocketstack/__pocketstack/mock/api");
  assert.equal(env.VITE_ADMIN_URL, "https://demo.test/pocketstack/__pocketstack/mock/admin-api/admin");
  assert.equal(env.POCKETSTACK_API_URL, "https://demo.test/pocketstack/__pocketstack/mock/api");
  assert.equal(env.VITE_POCKETSTACK_API_URL, "https://custom.test/api");
  assert.equal(env.POCKETSTACK_ADMIN_API_URL, "https://demo.test/pocketstack/__pocketstack/mock/admin-api");
  assert.equal(env.VITE_POCKETSTACK_ADMIN_API_URL, "https://demo.test/pocketstack/__pocketstack/mock/admin-api");
  assert.equal(env.POCKETSTACK_DB_URL, "https://demo.test/pocketstack/__pocketstack/db/db");
  assert.equal(env.VITE_POCKETSTACK_DB_URL, "https://demo.test/pocketstack/__pocketstack/db/db");
  assert.equal(env.POCKETSTACK_DB_DB_URL, "https://demo.test/pocketstack/__pocketstack/db/db");
  assert.equal(env.VITE_POCKETSTACK_DB_DB_URL, "https://demo.test/pocketstack/__pocketstack/db/db");
  assert.equal(env.POCKETSTACK_BRIDGE_URL, "/__pocketstack_bridge.js");
  assert.equal(env.VITE_POCKETSTACK_BRIDGE_URL, "/__pocketstack_bridge.js");
});
