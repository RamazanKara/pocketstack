# Browser-Native Conversion

PocketStack does not run arbitrary Docker containers in the browser. It helps
you turn the parts of a Compose project that matter *for a demo* into
browser-native pieces.

Use this guide when `pocketstack analyze` reports unsupported services. For how
each adapter is selected, see the [adapter matrix](/adapters/).

## The rule

Ask what the demo needs to prove.

If the viewer only needs to see UI, API behavior, seeded data, or a workflow,
you can often replace production infrastructure with browser-native adapters. If
the viewer needs real Linux processes, real networking, privileged behavior, or
production-grade persistence, that service is not a browser-native demo
candidate — leave it unsupported.

## Backend HTTP APIs → `mock-http`

Use [`mock-http`](/adapters/mock-http) when the frontend needs predictable API
responses.

```yaml
services:
  api:
    image: scratch
    labels:
      pocketstack.adapter: mock-http
      pocketstack.mock.openapi: openapi.yaml
      pocketstack.mock.fixtures: fixtures
      pocketstack.mock.port: "8080"
```

What to keep:

- OpenAPI paths and response examples;
- JSON fixtures for important states;
- request-aware fixtures for small dynamic behavior.

What not to claim:

- real backend business logic;
- arbitrary server middleware;
- production auth/session behavior.

## Redis, caches, queues, and workers → fixtures or in-browser state

Redis, queues, and background workers usually exist to support app behavior, not
to be inspected directly in a demo. Model the **visible result** instead:

- replace cached API responses with fixtures;
- represent queued jobs as seeded records;
- expose worker output as static JSON;
- move small state machines into [`frontend`](/adapters/frontend) demo code.

::: info
If the queue itself is the product, browser-only PocketStack v1 is not the right
runtime for that service.
:::

## Postgres → `postgres-pglite`

Keep demo schema and data in SQL files and map the service to
[`postgres-pglite`](/adapters/postgres-pglite):

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - ./db:/docker-entrypoint-initdb.d:ro
    labels:
      pocketstack.db.persist: indexeddb
```

Works well for schemas, seed data, simple SQL-backed demos, and resettable
browser storage. Does **not** emulate the Postgres TCP wire protocol, extensions
PGlite does not support, shell scripts in `/docker-entrypoint-initdb.d`, or
replication/users/permissions/tuning.

## MySQL, MariaDB, MongoDB, and other databases → SQLite / PGlite / fixtures

PocketStack v1 does not run these database servers in the browser. Choose the
smallest representation that still proves the workflow:

- use [`sqlite`](/adapters/sqlite) when the data can be relational and local;
- use [`postgres-pglite`](/adapters/postgres-pglite) when Postgres SQL behavior
  matters;
- use JSON fixtures via [`mock-http`](/adapters/mock-http) when the UI only needs
  API responses.

## Static sites → `static-web`

Mount the built site into a known document root and let
[`static-web`](/adapters/static-web) copy it:

```yaml
services:
  web:
    image: nginx:alpine
    volumes:
      - ./dist:/usr/share/nginx/html:ro
```

PocketStack copies files and rewrites common root-relative asset paths. It does
not emulate server rewrites, auth, compression, custom headers, or runtime
nginx/httpd/caddy behavior.

## Frontends → `frontend`

Make sure the project folder contains `package.json` and a runnable script, then
use [`frontend`](/adapters/frontend):

```yaml
services:
  app:
    image: node:22-alpine
    working_dir: /app
    command: npm run dev -- --host 0.0.0.0
    volumes:
      - ./app:/app
    ports:
      - "5173:5173"
```

If the frontend calls services by Compose hostnames such as `http://api:8080`,
PocketStack rewrites known mock/database service URLs for the generated demo.
See [service URLs](/reference/service-urls) for the endpoint shapes.

## Dockerfile builds → prebuild, then static / frontend / WASI

Browser-native demos do not run Docker builds. Instead:

- commit or generate static build output before running PocketStack (→
  [`static-web`](/adapters/static-web));
- mount frontend source directly (→ [`frontend`](/adapters/frontend));
- compile the relevant code to WASI yourself (→ [`wasi`](/adapters/wasi));
- describe backend behavior as OpenAPI mocks and fixtures (→
  [`mock-http`](/adapters/mock-http)).

## WASI → prebuilt module

PocketStack can package a prebuilt `.wasm` module with [`wasi`](/adapters/wasi):

```yaml
services:
  tool:
    image: scratch
    labels:
      pocketstack.adapter: wasi
      pocketstack.wasi.module: hello.wasm
      pocketstack.wasi.args: "--name PocketStack"
```

PocketStack does not convert arbitrary container images to WASI. If a project
compiles cleanly to WASI, do that in your build pipeline and point PocketStack at
the result.

## Conversion checklist

For each unsupported service:

- Identify what the viewer must experience in the demo.
- Replace invisible infrastructure with fixtures or seeded browser state.
- Replace APIs with [`mock-http`](/adapters/mock-http) when examples are enough.
- Replace demo databases with [`sqlite`](/adapters/sqlite) or
  [`postgres-pglite`](/adapters/postgres-pglite) when SQL matters.
- Compile to [`wasi`](/adapters/wasi) only when the app genuinely supports WASI.
- Leave the service unsupported when the demo needs real container semantics.
