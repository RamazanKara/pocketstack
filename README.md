# PocketStack

PocketStack turns compatible Docker Compose projects into shareable demos that run completely inside the browser.

> Drop in `docker-compose.yml`, get a static browser-native demo when every service can be adapted to browser primitives.

PocketStack v1 is deliberately browser-only. It does not start a hidden server, upload projects to a runner, require Docker at demo time, or pretend arbitrary Linux containers can run in a web page.

## Install

Download the latest `v1.x` binary from the GitHub release for `ramazankara/pocketstack`, or build from source:

```sh
git clone https://github.com/ramazankara/pocketstack.git
cd pocketstack
npm ci
npm run build:wasi-example
npm run build:runtime
go build -o bin/pocketstack ./cmd/pocketstack
```

## Quick Start

Analyze a Compose project:

```sh
pocketstack analyze -f compose.yaml
```

Generate a browser-only demo:

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Open `pocketstack-demo/index.html` from a static host. Frontend/WebContainer demos require cross-origin isolation headers; see [docs/HOSTING.md](docs/HOSTING.md).

## Supported Adapters

| Adapter | How it is selected | Browser runtime |
| --- | --- | --- |
| `static-web` | Autodetects `nginx`, `httpd`, or `caddy` with a local document-root bind mount | Static iframe preview |
| `frontend` | Autodetects Node/Bun images with a mounted `package.json`, or `pocketstack.adapter=frontend` | WebContainer-style in-browser Node runtime |
| `wasi` | `pocketstack.adapter=wasi` | Prebuilt `.wasm` module in browser WebAssembly/WASI runtime |
| `mock-http` | `pocketstack.adapter=mock-http` | Service worker routes from OpenAPI metadata and JSON fixtures |
| `postgres-pglite` | Autodetects `postgres` images, or `pocketstack.adapter=postgres-pglite` | PGlite with optional SQL init/seed |
| `sqlite` | `pocketstack.adapter=sqlite` | sql.js/sqlite-wasm with optional SQL init/seed |

Unsupported services are reported with concrete reasons. They must be adapted to one of the browser-native adapters before a demo can be generated.

## Labels

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

## Commands

```text
pocketstack analyze [-f compose.yaml] [--json]
pocketstack demo [-f compose.yaml] [-o pocketstack-demo]
pocketstack version
```

## Release Checks

```sh
npm ci
npm run build:wasi-example
npm run build:runtime
npm run test:runtime
go test ./...
go vet ./...
make smoke
goreleaser release --clean --skip=publish
```
