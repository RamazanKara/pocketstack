# Adapters

PocketStack converts a browser-compatible Docker Compose project into a static,
browser-native demo. Every Compose service maps to one **adapter** — a browser
primitive that runs entirely in the tab — or is reported as unsupported with
concrete conversion suggestions.

A project generates only when **every** service maps to an adapter. If even one
service needs Docker/container semantics PocketStack cannot represent honestly,
generation stops and you get a [readiness report](#readiness-report) instead.

## Adapter matrix

There are six adapters. Five are selected with the `pocketstack.adapter` label;
`static-web` is autodetected and has no label.

| Adapter | Maps | How it's selected |
| --- | --- | --- |
| [`static-web`](/adapters/static-web) | `nginx` / `httpd` / `caddy` static sites | **Autodetected** from the image + a document-root mount (no label) |
| [`frontend`](/adapters/frontend) | Node/Bun projects that run from source | Autodetected (Node/Bun image + `package.json`), or `pocketstack.adapter=frontend` |
| [`mock-http`](/adapters/mock-http) | OpenAPI + JSON fixtures as browser routes | `pocketstack.adapter=mock-http` |
| [`postgres-pglite`](/adapters/postgres-pglite) | Postgres-shaped demos backed by PGlite | `pocketstack.adapter=postgres-pglite` |
| [`sqlite`](/adapters/sqlite) | SQLite demos seeded from SQL or a `.db` file | `pocketstack.adapter=sqlite` |
| [`wasi`](/adapters/wasi) | Prebuilt `.wasm` modules | `pocketstack.adapter=wasi` |

See the [labels reference](/adapters/labels) for every label and its accepted
values.

::: info
Unsupported is not permanent. It means there is no honest browser adapter for
that behavior yet. Docker builds, privileged containers, opaque volumes,
arbitrary daemons, and Linux networking remain unsupported in browser-only v1.
:::

## Compose features

PocketStack analyzes a **single** Compose file and maps the default service set
to adapters. A few directives are handled specifically:

- **`profiles:`** — services gated behind a profile are not started by a default
  `docker compose up`, so PocketStack skips them. Skipped services do not count
  toward, or block, browser readiness, and the analysis warns when they are
  skipped.
- **`extends:`** — unsupported. PocketStack does not resolve an extended base
  service. Flatten the service (inline its image, labels, ports, and volumes)
  before analyzing.
- **Multiple files / overrides** — pass a single file with `-f`. Merge any
  overrides yourself first.
- **Port ranges** such as `3000-3005:3000-3005` are accepted; the first port of
  the range is used and adapter selection does not depend on the exact port.
- **Image normalization** — short names (`postgres`), Docker Hub official names
  (`library/postgres`), and registry-qualified names
  (`docker.io/library/postgres:16`, `ghcr.io/org/app`) all resolve to the same
  adapter.
- **`depends_on:` / `healthcheck:`** — parsed but ignored. A static demo has no
  startup ordering or health gating.

## Readiness report

`pocketstack analyze` is useful even when generation is blocked. Every analysis
result includes:

- **`readiness.status`** — `ready`, `partial`, or `blocked`;
- **`readiness.score`** — the percentage of services that are browser-native;
- service-level **`unsupported`** reasons;
- service-level **`suggestions`**;
- project-level **`nextSteps`**.

The goal is to make unsupported services actionable. For example, a Redis
service is reported as stateful browser-incompatible and points you toward
SQLite, PGlite, fixtures, or in-browser mock state for the demo.

## Unsupported services

When a service has no honest adapter, reshape the demo rather than expecting a
hidden runner. The [conversion guide](/convert/) walks through replacing
backends with `mock-http`, databases with `sqlite` or `postgres-pglite`, caches
and queues with fixtures or in-browser state, and Dockerfile builds with
prebuilt output.
