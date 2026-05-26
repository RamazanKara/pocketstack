# PocketStack

PocketStack turns compatible Docker Compose projects into shareable demos that
run completely inside the browser.

> Drop in `docker-compose.yml`, get a static browser-native demo when every
> service can be mapped to browser primitives.

PocketStack v1 is deliberately browser-only. Generated demos do not start a
hidden server, upload projects to a runner, require Docker at demo time, or
claim that arbitrary Linux containers run in a web page.

[![PocketStack announcement video](docs/media/pocketstack-announcement-poster.png)](docs/media/pocketstack-announcement.mp4)

## Install

Download the latest `v1.x` binary from the GitHub release for
`ramazankara/pocketstack`, or build from source:

```sh
git clone https://github.com/ramazankara/pocketstack.git
cd pocketstack
nvm use
npm ci
npm run build:wasi-example
npm run build:runtime
go build -o bin/pocketstack ./cmd/pocketstack
```

The JavaScript toolchain targets the current Node line, Node 26.

## Quick Start

Analyze a Compose project:

```sh
pocketstack analyze -f compose.yaml
```

Generate a browser-only demo:

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Serve `pocketstack-demo/` from any static host. Frontend/WebContainer and some
WASI demos require COOP/COEP headers; PocketStack emits host config files when
they are needed. See [docs/HOSTING.md](docs/HOSTING.md).

The public Studio and generated examples are published with GitHub Pages at
<https://ramazankara.github.io/pocketstack/>.

## Studio

PocketStack Studio is a static browser page for quick compatibility checks.
Paste Compose YAML, upload a Compose file, and optionally add the project
folder so Studio can inspect mounted assets.

```sh
make studio
```

Open <http://127.0.0.1:4173/>. Use `make studio PORT=4174` if that port is
busy. Studio runs entirely in the tab; it does not call a PocketStack backend,
Docker daemon, runner, or hidden server.

## Supported Adapters

| Adapter | Selected by | Browser behavior |
| --- | --- | --- |
| `static-web` | Autodetected `nginx`, `httpd`, or `caddy` document-root mounts | Copies regular static files and previews them in an iframe |
| `frontend` | Node/Bun image plus `package.json`, or `pocketstack.adapter=frontend` | Runs a packaged project in a WebContainer-style browser runtime |
| `wasi` | `pocketstack.adapter=wasi` plus `pocketstack.wasi.module` | Runs a prebuilt `.wasm` module with browser WASI support |
| `mock-http` | `pocketstack.adapter=mock-http` | Serves OpenAPI routes and JSON fixtures from the demo service worker |
| `postgres-pglite` | Postgres image or `pocketstack.adapter=postgres-pglite` | Maps supported Postgres demos to PGlite with resettable browser storage |
| `sqlite` | `pocketstack.adapter=sqlite` | Runs SQLite from SQL or seed database assets in the browser |

Unsupported services are reported with concrete reasons and no server fallback.
See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for exact behavior and
limits.

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

## Docs

- [Browser-only contract](docs/BROWSER_ONLY.md)
- [Compatibility matrix](docs/COMPATIBILITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Static hosting](docs/HOSTING.md)
- [Website integration](docs/WEBSITE_INTEGRATION.md)
- [Browser testing](docs/BROWSER_TESTING.md)
- [Release process](docs/RELEASE.md)
- [Studio](studio/README.md)

## Release Checks

```sh
make release-check
```
