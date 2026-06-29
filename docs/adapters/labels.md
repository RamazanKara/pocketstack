# Labels

Use labels when PocketStack cannot safely infer intent from a service's image
and mounts. This page is the full label reference.

`static-web` is **autodetected** from a supported image plus a document-root
mount — it has no label. The other five adapters are selected explicitly with
`pocketstack.adapter`.

```yaml
labels:
  pocketstack.adapter: frontend|wasi|mock-http|postgres-pglite|sqlite
  pocketstack.frontend.install: npm install
  pocketstack.frontend.start: npm run dev -- --host 0.0.0.0
  pocketstack.frontend.port: "5173"
  pocketstack.wasi.module: hello.wasm
  pocketstack.wasi.args: "--name PocketStack"
  pocketstack.mock.openapi: openapi.yaml
  pocketstack.mock.fixtures: fixtures
  pocketstack.mock.port: "8080"
  pocketstack.db.init: init.sql
  pocketstack.db.seed: seed.sql
  pocketstack.db.persist: indexeddb|memory
```

## Selecting an adapter

- **`pocketstack.adapter`** — selects the adapter for the service. Accepted
  values: `frontend`, `wasi`, `mock-http`, `postgres-pglite`, `sqlite`. Omit it
  for `static-web`, which is autodetected.

## Frontend labels

See the [frontend adapter](/adapters/frontend) for details.

- **`pocketstack.frontend.install`** — the install command run for the project
  (for example `npm install`).
- **`pocketstack.frontend.start`** — the start command for the dev server (for
  example `npm run dev -- --host 0.0.0.0`).
- **`pocketstack.frontend.port`** — the port the dev server listens on, as a
  quoted string (for example `"5173"`).

## WASI labels

See the [wasi adapter](/adapters/wasi) for details.

- **`pocketstack.wasi.module`** — path to the prebuilt `.wasm` module to run.
- **`pocketstack.wasi.args`** — argv passed to the module (for example
  `"--name PocketStack"`).

## Mock HTTP labels

See the [mock-http adapter](/adapters/mock-http) for details.

- **`pocketstack.mock.openapi`** — path to the OpenAPI spec (YAML or JSON).
- **`pocketstack.mock.fixtures`** — directory of `.json` fixture files. A
  fixtures-only mock must contain at least one JSON fixture.
- **`pocketstack.mock.port`** — the port the mock service listens on, as a
  quoted string (for example `"8080"`).

## Database labels

Shared by the [sqlite](/adapters/sqlite) and
[postgres-pglite](/adapters/postgres-pglite) adapters.

- **`pocketstack.db.init`** — path to a SQL file run to initialize the database
  schema.
- **`pocketstack.db.seed`** — path to a SQL file run to seed data.
- **`pocketstack.db.persist`** — persistence mode. Accepted values:
  `indexeddb` (persist across reloads) or `memory` (no persistence).
