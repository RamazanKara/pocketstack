import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MessageChannel } from "node:worker_threads";
import vm from "node:vm";
import test from "node:test";

async function loadWorker(options = {}) {
  const listeners = {};
  const databaseHandlers = new Map();
  if (options.databaseHandler) databaseHandlers.set("client-1", options.databaseHandler);
  for (const [id, handler] of Object.entries(options.databaseHandlers || {})) {
    databaseHandlers.set(id, handler);
  }
  const windowClients = new Map(Array.from(databaseHandlers, ([id, handler]) => [id, {
    id,
    postMessage(message, ports = []) {
      ports[0]?.start?.();
      Promise.resolve(handler(message))
        .then((result) => ports[0]?.postMessage(result))
        .catch((error) => ports[0]?.postMessage({ ok: false, error: error.message }))
        .finally(() => ports[0]?.close?.());
    },
  }]));
  const context = {
    URL,
    URLSearchParams,
    Response,
    Headers,
    MessageChannel,
    Object,
    JSON,
    Map,
    setTimeout,
    clearTimeout,
    self: {
      addEventListener(name, handler) {
        listeners[name] = handler;
      },
      clients: {
        claim: () => Promise.resolve(),
        get: async (id) => windowClients.get(id) || null,
        matchAll: async () => Array.from(windowClients.values()),
      },
      skipWaiting: () => Promise.resolve(),
    },
  };
  const source = await readFile(new URL("../../../internal/generator/runtime/mock-sw.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);

  return {
    sendRoutes(service, routes) {
      listeners.message({ data: { type: "POCKETSTACK_ROUTES", service, routes } });
    },
    async fetch(url, method = "GET", options = {}) {
      let responsePromise;
      const headers = new Map(Object.entries(options.headers || {}));
      const body = options.body || "";
      const event = {
        request: {
          url,
          method,
          headers: {
            get(name) {
              return headers.get(name) || headers.get(name.toLowerCase()) || "";
            },
          },
          text: async () => body,
        },
        respondWith(promise) {
          responsePromise = Promise.resolve(promise);
        },
      };
      if (options.clientId !== null) {
        event.clientId = options.clientId || "client-1";
      }
      listeners.fetch(event);
      return responsePromise;
    },
  };
}

test("mock service worker matches path templates while ignoring extra query params", async () => {
  const worker = await loadWorker();
  worker.sendRoutes("api", [
    {
      method: "GET",
      path: "/users/{id}",
      status: 200,
      body: { ok: true },
    },
  ]);

  const response = await worker.fetch("https://demo.test/app/__pocketstack/mock/api/users/123?verbose=true");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("mock service worker supports fixture query constraints", async () => {
  const worker = await loadWorker();
  worker.sendRoutes("api", [
    {
      method: "GET",
      path: "/search",
      query: "q=demo&type=user",
      status: 200,
      body: { match: true },
    },
  ]);

  const match = await worker.fetch("https://demo.test/__pocketstack/mock/api/search?q=demo&type=user&extra=1");
  assert.equal(match.status, 200);
  assert.deepEqual(await match.json(), { match: true });

  const miss = await worker.fetch("https://demo.test/__pocketstack/mock/api/search?q=other&type=user");
  assert.equal(miss.status, 404);
  assert.deepEqual(await miss.json(), {
    error: "mock route not found",
    path: "/search",
    query: { q: "other", type: "user" },
  });
});

test("mock service worker can echo request metadata and JSON body", async () => {
  const worker = await loadWorker();
  worker.sendRoutes("api", [
    {
      method: "POST",
      path: "/echo",
      status: 201,
      bodyFrom: "request",
    },
    {
      method: "POST",
      path: "/json",
      bodyFrom: "request.json",
    },
  ]);

  const echo = await worker.fetch("https://demo.test/__pocketstack/mock/api/echo?trace=1", "POST", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada" }),
  });
  assert.equal(echo.status, 201);
  assert.deepEqual(await echo.json(), {
    method: "POST",
    path: "/echo",
    params: {},
    query: { trace: "1" },
    body: { name: "Ada" },
  });

  const json = await worker.fetch("https://demo.test/__pocketstack/mock/api/json", "POST", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await json.json(), { ok: true });
});

test("mock service worker exposes path params to request-aware fixtures", async () => {
  const worker = await loadWorker();
  worker.sendRoutes("api", [
    {
      method: "GET",
      path: "/users/{id}/posts/{postId}",
      bodyFrom: "request",
    },
    {
      method: "GET",
      path: "/accounts/{accountId}",
      bodyFrom: "request.params",
    },
  ]);

  const full = await worker.fetch("https://demo.test/__pocketstack/mock/api/users/42/posts/abc?include=comments");
  assert.deepEqual(await full.json(), {
    method: "GET",
    path: "/users/42/posts/abc",
    params: { id: "42", postId: "abc" },
    query: { include: "comments" },
    body: null,
  });

  const params = await worker.fetch("https://demo.test/__pocketstack/mock/api/accounts/acct_123");
  assert.deepEqual(await params.json(), { accountId: "acct_123" });
});

test("mock service worker preserves text bodies and no-body responses", async () => {
  const worker = await loadWorker();
  worker.sendRoutes("api", [
    {
      method: "POST",
      path: "/created",
      status: 201,
      headers: { "content-type": "text/plain", "x-request-id": "req_demo" },
      body: "created",
    },
    {
      method: "DELETE",
      path: "/empty",
      status: 204,
      body: { ignored: true },
    },
    {
      method: "HEAD",
      path: "/head",
      status: 200,
      body: { ignored: true },
    },
  ]);

  const created = await worker.fetch("https://demo.test/__pocketstack/mock/api/created", "POST");
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("content-type"), "text/plain");
  assert.equal(created.headers.get("x-request-id"), "req_demo");
  assert.equal(await created.text(), "created");

  const empty = await worker.fetch("https://demo.test/__pocketstack/mock/api/empty", "DELETE");
  assert.equal(empty.status, 204);
  assert.equal(empty.headers.get("content-type"), null);
  assert.equal(await empty.text(), "");

  const head = await worker.fetch("https://demo.test/__pocketstack/mock/api/head", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("mock service worker provides CORS headers and preflight responses", async () => {
  const worker = await loadWorker();
  worker.sendRoutes("api", [
    {
      method: "GET",
      path: "/health",
      status: 200,
      body: { ok: true },
    },
  ]);

  const preflight = await worker.fetch("https://demo.test/__pocketstack/mock/api/health", "OPTIONS", {
    headers: {
      "access-control-request-headers": "x-demo-token",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-methods"), /OPTIONS/);
  assert.equal(preflight.headers.get("access-control-allow-headers"), "x-demo-token");

  const response = await worker.fetch("https://demo.test/__pocketstack/mock/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await response.json(), { ok: true });
});

test("service worker forwards browser database query endpoints to the dashboard", async () => {
  const worker = await loadWorker({
    databaseHandler(message) {
      assert.equal(message.type, "POCKETSTACK_DB_QUERY");
      assert.equal(message.service, "db");
      assert.equal(message.sql, "select 1 as ok");
      return { ok: true, result: [{ ok: 1 }] };
    },
  });

  const preflight = await worker.fetch("https://demo.test/__pocketstack/db/db/query", "OPTIONS", {
    headers: { "access-control-request-headers": "content-type" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

  const response = await worker.fetch("https://demo.test/__pocketstack/db/db/query", "POST", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: "select 1 as ok" }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await response.json(), {
    service: "db",
    result: [{ ok: 1 }],
  });
});

test("service worker routes browser database queries to the requesting dashboard client", async () => {
  let firstClientCalls = 0;
  let secondClientCalls = 0;
  const worker = await loadWorker({
    databaseHandlers: {
      "client-a": () => {
        firstClientCalls += 1;
        return { ok: true, result: [{ client: "a" }] };
      },
      "client-b": (message) => {
        secondClientCalls += 1;
        assert.equal(message.service, "db");
        assert.equal(message.sql, "select current_client");
        return { ok: true, result: [{ client: "b" }] };
      },
    },
  });

  const response = await worker.fetch("https://demo.test/__pocketstack/db/db/query", "POST", {
    clientId: "client-b",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: "select current_client" }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), {
    service: "db",
    result: [{ client: "b" }],
  });
  assert.equal(firstClientCalls, 0);
  assert.equal(secondClientCalls, 1);
});

test("service worker reports missing browser database SQL clearly", async () => {
  const worker = await loadWorker({
    databaseHandler() {
      throw new Error("should not be called");
    },
  });

  const response = await worker.fetch("https://demo.test/__pocketstack/db/db/query", "POST", {
    headers: { "content-type": "text/plain" },
    body: "",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "missing SQL query" });
});
