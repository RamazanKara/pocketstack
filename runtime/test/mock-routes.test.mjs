import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";

async function loadRouteModule() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/mock-routes.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("OpenAPI documents produce mock routes from examples and schemas", async () => {
  const { routesFromOpenAPIDocument } = await loadRouteModule();
  const routes = routesFromOpenAPIDocument({
    openapi: "3.0.0",
    paths: {
      "/health": {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  example: { ok: true },
                },
              },
            },
          },
        },
      },
      "/users/{id}": {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string", example: "demo-user" },
                      active: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(routes, [
    {
      method: "GET",
      path: "/health",
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
      source: "openapi",
    },
    {
      method: "GET",
      path: "/users/{id}",
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "demo-user", active: true },
      source: "openapi",
    },
  ]);
});

test("fixture routes override OpenAPI defaults for the same method and path", async () => {
  const { mergeMockRoutes, normalizeFixtureRoute, splitRoutePath } = await loadRouteModule();
  assert.deepEqual(splitRoutePath("/search?q=demo"), { path: "/search", query: "q=demo" });
  assert.deepEqual(normalizeFixtureRoute({ path: "/search?q=demo" }), {
    method: "GET",
    path: "/search",
    query: "q=demo",
    status: 200,
    headers: { "content-type": "application/json" },
    body: { path: "/search?q=demo" },
    source: "fixture",
  });
  assert.deepEqual(normalizeFixtureRoute({ method: "POST", path: "/echo", bodyFrom: "request" }), {
    method: "POST",
    path: "/echo",
    status: 200,
    headers: { "content-type": "application/json" },
    bodyFrom: "request",
    source: "fixture",
  });
  const routes = mergeMockRoutes(
    [
      {
        method: "GET",
        path: "/health",
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true, source: "openapi" },
      },
    ],
    [
      {
        method: "GET",
        path: "/health",
        status: 503,
        body: { ok: false, source: "fixture" },
      },
    ],
  );

  assert.deepEqual(routes, [
    {
      method: "GET",
      path: "/health",
      status: 503,
      headers: { "content-type": "application/json" },
      body: { ok: false, source: "fixture" },
      source: "fixture",
    },
  ]);
});

test("OpenAPI mock routes resolve local component refs", async () => {
  const { resolvePointer, routesFromOpenAPIDocument } = await loadRouteModule();
  const document = {
    openapi: "3.0.0",
    paths: {
      "/users/{id}": {
        get: {
          responses: {
            "200": { $ref: "#/components/responses/UserResponse" },
          },
        },
      },
      "/teams": {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Team" },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      responses: {
        UserResponse: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/User" },
            },
          },
        },
      },
      schemas: {
        User: {
          allOf: [
            {
              type: "object",
              properties: {
                id: { type: "string", example: "user-1" },
              },
            },
            {
              type: "object",
              properties: {
                role: { $ref: "#/components/schemas/Role" },
              },
            },
          ],
        },
        Role: {
          type: "string",
          enum: ["admin", "reader"],
        },
        Team: {
          type: "object",
          properties: {
            name: { type: "string", default: "Core" },
          },
        },
      },
    },
  };

  assert.equal(resolvePointer(document, "#/components/schemas/Role").enum[0], "admin");
  assert.deepEqual(routesFromOpenAPIDocument(document), [
    {
      method: "GET",
      path: "/users/{id}",
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "user-1", role: "admin" },
      source: "openapi",
    },
    {
      method: "GET",
      path: "/teams",
      status: 200,
      headers: { "content-type": "application/json" },
      body: [{ name: "Core" }],
      source: "openapi",
    },
  ]);
});

test("OpenAPI mock routes preserve status, headers, content type, and no-body responses", async () => {
  const { responseAllowsBody, routesFromOpenAPIDocument } = await loadRouteModule();
  assert.equal(responseAllowsBody("GET", 204), false);
  assert.equal(responseAllowsBody("HEAD", 200), false);
  assert.equal(responseAllowsBody("POST", 201), true);

  const routes = routesFromOpenAPIDocument({
    openapi: "3.0.0",
    paths: {
      "/created": {
        post: {
          responses: {
            "201": {
              headers: {
                "X-Request-Id": {
                  schema: { type: "string", default: "req_demo" },
                },
              },
              content: {
                "text/plain": {
                  example: "created",
                },
              },
            },
          },
        },
      },
      "/empty": {
        delete: {
          responses: {
            "204": {
              headers: {
                "X-Deleted": {
                  schema: { type: "boolean", default: true },
                },
              },
              content: {
                "application/json": {
                  example: { ignored: true },
                },
              },
            },
          },
        },
      },
      "/head": {
        head: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  example: { ignored: true },
                },
              },
            },
          },
        },
      },
      "/vendor": {
        get: {
          responses: {
            "200": {
              content: {
                "text/plain": {
                  example: "plain",
                },
                "application/vnd.api+json": {
                  example: { data: [] },
                },
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(routes, [
    {
      method: "POST",
      path: "/created",
      status: 201,
      headers: { "X-Request-Id": "req_demo", "content-type": "text/plain" },
      body: "created",
      source: "openapi",
    },
    {
      method: "DELETE",
      path: "/empty",
      status: 204,
      headers: { "X-Deleted": "true" },
      source: "openapi",
    },
    {
      method: "HEAD",
      path: "/head",
      status: 200,
      source: "openapi",
    },
    {
      method: "GET",
      path: "/vendor",
      status: 200,
      headers: { "content-type": "application/vnd.api+json" },
      body: { data: [] },
      source: "openapi",
    },
  ]);
});

test("OpenAPI mock routes resolve path item refs and required query examples", async () => {
  const { parameterExample, queryFromParameters, routesFromOpenAPIDocument } = await loadRouteModule();
  const document = {
    openapi: "3.1.0",
    paths: {
      "/search": {
        $ref: "#/components/pathItems/Search",
      },
      "/reports": {
        parameters: [
          {
            $ref: "#/components/parameters/Tenant",
          },
        ],
        get: {
          parameters: [
            {
              name: "page",
              in: "query",
              required: true,
              schema: { type: "integer", default: 2 },
            },
            {
              name: "tenant",
              in: "query",
              required: true,
              example: "operation-tenant",
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  example: { ok: true },
                },
              },
            },
          },
        },
      },
    },
    components: {
      parameters: {
        Tenant: {
          name: "tenant",
          in: "query",
          required: true,
          schema: { type: "string", default: "path-tenant" },
        },
      },
      pathItems: {
        Search: {
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              examples: {
                demo: { value: "pocketstack" },
              },
            },
          ],
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        results: { type: "array", items: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  assert.equal(parameterExample(document.components.parameters.Tenant, document), "path-tenant");
  assert.equal(queryFromParameters([document.components.parameters.Tenant], document), "tenant=path-tenant");
  assert.deepEqual(routesFromOpenAPIDocument(document), [
    {
      method: "GET",
      path: "/search",
      query: "q=pocketstack",
      status: 200,
      headers: { "content-type": "application/json" },
      body: { results: ["string"] },
      source: "openapi",
    },
    {
      method: "GET",
      path: "/reports",
      query: "tenant=operation-tenant&page=2",
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
      source: "openapi",
    },
  ]);
});

test("fixture routes support no-body statuses", async () => {
  const { normalizeFixtureRoute } = await loadRouteModule();

  assert.deepEqual(normalizeFixtureRoute({ method: "DELETE", path: "/empty", status: 204, body: { ignored: true } }), {
    method: "DELETE",
    path: "/empty",
    status: 204,
    source: "fixture",
  });
});
