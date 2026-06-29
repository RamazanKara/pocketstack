# Service URLs

A generated demo exposes two families of browser-only URLs that custom frontend
code can call. They are served by a **service worker running inside the demo
tab** — not by a backend.

```text
/__pocketstack/mock/<service>/<route>
/__pocketstack/db/<service>/query
```

::: warning
These endpoints exist only inside the generated browser demo. They are **not**
Docker networking, Postgres TCP, an HTTP proxy, or a real backend. There is no
server to reach — the service worker answers requests in the tab. Treat `<service>`
and `<route>` as placeholders for your service name and route path.
:::

Use them for custom demo controls, fixture explorers, or small query panels that
live next to an embedded demo. For embedding context, see
[website integration](/deploy/website-integration).

## Mock route endpoint

For a `mock-http` service named `<service>`, routes from its OpenAPI spec and
JSON fixtures are registered at:

```text
/__pocketstack/mock/<service>/<route>
```

The `<route>` mirrors the path defined in the service's OpenAPI document or
fixtures. Requests are answered by the mock service worker (`mock-sw.js`) using
the registered response examples and fixtures, with CORS/preflight support.

Example — fetch a mocked API route for a service named `api`:

```js
const response = await fetch("/__pocketstack/mock/api/users");
const users = await response.json();
```

```sh
curl https://example.com/demo/__pocketstack/mock/api/users
```

::: info
A `mock-http` service returns the fixture/OpenAPI examples it was generated
with. It does not run real backend logic, middleware, or production auth. See
the [mock-http adapter](/adapters/mock-http) for what to put in the spec and
fixtures. Frontend code that points at a Compose-style URL such as
`http://api:8080` is rewritten to this mock URL automatically — see the
[frontend adapter](/adapters/frontend).
:::

## Database query endpoint

For a `postgres-pglite` or `sqlite` service named `<service>`, SQL runs against
the in-browser database at:

```text
POST /__pocketstack/db/<service>/query
```

- **Method:** `POST`
- **Request body:** JSON `{"sql": "<statement>"}`
- **Response:** adapter-native JSON result

Multi-statement SQL (`insert …; select …;`) is supported on both database
adapters.

Example — run a query with `fetch` against a service named `db`:

```js
const response = await fetch("/__pocketstack/db/db/query", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sql: "select 1" }),
});
const payload = await response.json();
```

Example — the same query with `curl`:

```sh
curl -X POST https://example.com/demo/__pocketstack/db/db/query \
  -H "content-type: application/json" \
  -d '{"sql":"select 1"}'
```

The response shape is **adapter-native**: PGlite returns PGlite's result JSON,
and SQLite (sql.js) returns sql.js's result JSON. Read the per-adapter pages for
details: [postgres-pglite](/adapters/postgres-pglite) and
[sqlite](/adapters/sqlite).

::: warning
This endpoint does not speak the Postgres or MySQL wire protocol and is not a
database server. It runs SQL against a browser database (PGlite or sql.js) seeded
from the demo's assets, and persists only to browser storage under the demo's
`storageNamespace`.
:::

## Notes for custom UI

- Use **relative** URLs (`/__pocketstack/...`) so the demo keeps working under a
  subpath. Generated demos use relative paths throughout.
- These URLs are only live once the demo's service worker has registered, so
  call them from code running inside (or alongside) the loaded demo.
- The available `<service>` names and `<route>` paths come from the generated
  [manifest](/deploy/manifest): each service's `name`, `adapter`, and `config`
  describe what is registered.
