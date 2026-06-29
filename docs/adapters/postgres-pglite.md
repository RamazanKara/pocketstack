# PGlite Postgres

The `postgres-pglite` adapter maps Postgres-shaped demos to **PGlite**, a
Postgres build that runs in the browser. It packages your schema and seed SQL and
serves a resettable in-browser database.

## How it's selected

Set `pocketstack.adapter=postgres-pglite` and provide SQL through the
`pocketstack.db.*` labels or bind mounts under `/docker-entrypoint-initdb.d`.

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - ./db:/docker-entrypoint-initdb.d:ro
    labels:
      pocketstack.adapter: postgres-pglite
      pocketstack.db.init: init.sql
      pocketstack.db.seed: seed.sql
      pocketstack.db.persist: indexeddb
```

See the [labels reference](/adapters/labels) for accepted values
(`pocketstack.db.persist` is `indexeddb` or `memory`).

## SQL sources

The adapter packages SQL files from:

- `pocketstack.db.init`;
- `pocketstack.db.seed`;
- local bind mounts under `/docker-entrypoint-initdb.d`.

Multi-statement SQL is run through PGlite's exec.

::: warning
Shell scripts, compressed dumps, and other Docker entrypoint behavior are **not**
run in browser-only mode. Only SQL is executed.
:::

## Persistence and reset

SQL files execute **once** for persisted databases and **again after reset**.
Use `pocketstack.db.persist: indexeddb` to persist across reloads, or `memory`
for a fresh database each load. Generated demos include a stable storage
namespace so multiple PocketStack demos can share one static origin without
reusing the same IndexedDB keys.

## Querying the database

The adapter exposes a demo-only query endpoint at
`/__pocketstack/db/<service>/query`. Send `POST` JSON such as `{"sql":"select 1"}`
and receive adapter-native JSON. This is for demos and custom browser UI — it is
not a Postgres TCP server, Docker networking, or a backend proxy. See the
[service URLs](/reference/service-urls) for the full request/response shape.
