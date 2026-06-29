# SQLite

The `sqlite` adapter runs SQLite in the browser via **sql.js**, seeded from SQL
or a binary database file. It is a good fit for small relational demos that need
real SQL but not a server.

## How it's selected

Set `pocketstack.adapter=sqlite` and provide seed assets through the
`pocketstack.db.*` labels or bind mounts.

```yaml
services:
  db:
    image: scratch
    labels:
      pocketstack.adapter: sqlite
      pocketstack.db.init: schema.sql
      pocketstack.db.seed: seed.sql
      pocketstack.db.persist: indexeddb
```

See the [labels reference](/adapters/labels) for accepted values
(`pocketstack.db.persist` is `indexeddb` or `memory`).

## Seed sources

The `sqlite` adapter can package:

- a single `.sql` file;
- a directory of `.sql` files — executed in **sorted order**;
- a binary `.db`, `.sqlite`, or `.sqlite3` seed file.

Binary database seeds are loaded as the starting database image rather than
executed as SQL.

## Persistence

Generated demos include a stable storage namespace so multiple PocketStack demos
can share one static origin without reusing the same IndexedDB keys. Use
`pocketstack.db.persist: indexeddb` to persist across reloads, or `memory` for a
fresh database each load.

## Querying the database

The adapter exposes a demo-only query endpoint at
`/__pocketstack/db/<service>/query`. Send `POST` JSON such as `{"sql":"select 1"}`
and receive adapter-native JSON. This is for demos and custom browser UI — it is
not a database server or backend proxy. See the
[service URLs](/reference/service-urls) for the full request/response shape.

## Frontend integration

Frontend environments receive both URL and DB URL variables, for example
`POCKETSTACK_DB_URL`, `VITE_POCKETSTACK_DB_URL`, `POCKETSTACK_DB_DB_URL`, and
`VITE_POCKETSTACK_DB_DB_URL`.
