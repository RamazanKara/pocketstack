# Browser-Native Conversion Guide

PocketStack does not run arbitrary Docker containers in the browser. It helps
you turn the parts of a Compose project that matter for a demo into
browser-native pieces.

Use this guide when `pocketstack analyze` reports unsupported services.

## The Rule

Ask what the demo needs to prove.

If the viewer only needs to see UI, API behavior, seeded data, or a workflow,
you can often replace production infrastructure with browser-native demo
adapters. If the viewer needs real Linux processes, real networking, privileged
behavior, or production-grade persistence, that service is not a browser-native
demo candidate.

## Backend HTTP APIs

Best browser-native replacement: `mock-http`.

Use this when the frontend needs predictable API responses.

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

## Redis, Caches, Queues, and Workers

Best browser-native replacement: fixture state or in-browser state.

Redis, queues, and background workers usually exist to support app behavior,
not to be inspected directly in a demo. For a browser-native demo, model the
visible result instead:

- replace cached API responses with fixtures;
- represent queued jobs as seeded records;
- expose worker output as static JSON;
- move small state machines into frontend demo code.

If the queue itself is the product, PocketStack v1 is not the right runtime.

## Postgres

Best browser-native replacement: `postgres-pglite`.

Keep demo schema and data in SQL files:

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - ./db:/docker-entrypoint-initdb.d:ro
    labels:
      pocketstack.db.persist: indexeddb
```

Works well for:

- schemas;
- seed data;
- simple SQL-backed demos;
- resettable browser storage.

Does not emulate:

- Postgres TCP wire protocol;
- extensions that PGlite does not support;
- shell scripts in `/docker-entrypoint-initdb.d`;
- replication, users, permissions, or server tuning.

## MySQL, MariaDB, MongoDB, and Other Databases

Best browser-native replacement: SQLite, PGlite, or fixtures.

For demo purposes, choose the smallest representation that still proves the
workflow:

- use SQLite when the data can be relational and local;
- use PGlite when Postgres SQL behavior matters;
- use JSON fixtures when the UI only needs API responses.

PocketStack v1 does not run these database servers in the browser.

## Static Sites

Best browser-native replacement: `static-web`.

Mount the built site into a known document root:

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

## Frontends

Best browser-native replacement: `frontend`.

Make sure the project folder contains `package.json` and a runnable script:

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
PocketStack can rewrite known mock/database service URLs for the generated
demo.

## Dockerfile Builds

Browser-native demos do not run Docker builds.

Use one of these instead:

- commit or generate static build output before running PocketStack;
- mount frontend source directly;
- compile the relevant code to WASI yourself;
- describe backend behavior as OpenAPI mocks and fixtures.

## WASI

Best browser-native replacement: `wasi`.

PocketStack can package a prebuilt `.wasm` module:

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
can compile cleanly to WASI, do that in your build pipeline and point
PocketStack at the result.

## Conversion Checklist

For each unsupported service:

- Identify what the viewer must experience in the demo.
- Replace invisible infrastructure with fixtures or seeded browser state.
- Replace APIs with `mock-http` when examples are enough.
- Replace demo databases with SQLite or PGlite when SQL matters.
- Compile to WASI only when the app genuinely supports WASI.
- Leave the service unsupported when the demo needs real container semantics.
