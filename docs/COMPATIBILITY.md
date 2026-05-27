# Compatibility Matrix

PocketStack v1 supports Compose projects when every service maps to a real
browser adapter. If even one service needs Docker/container semantics that
PocketStack cannot represent honestly, generation stops with an unsupported
reason.

`pocketstack analyze` is designed to be useful even when generation is blocked.
It reports a browser-readiness score, service blockers, and conversion
suggestions for turning a Compose stack into a browser-native demo.

The short version:

- Static sites are the easiest fit.
- Frontend apps can work when their source and package scripts are available.
- APIs can be mocked from OpenAPI plus fixtures.
- Small database demos can use PGlite or SQLite.
- WASI works for prebuilt `.wasm` modules.
- Arbitrary Linux containers, Docker builds, privileged daemons, and real
  container networking are out of scope for browser-only v1.

## Adapter Matrix

- `static-web`: supports `nginx`, `httpd`, or `caddy` services with
  document-root mounts. Regular files and directories are copied into the
  generated demo.
- `frontend`: supports Node/Bun frontend projects with `package.json` and a
  runnable command or script.
- `wasi`: supports explicitly labeled prebuilt WASM modules with browser WASI
  and a Wasmer JS fallback.
- `mock-http`: supports OpenAPI YAML/JSON plus optional JSON fixtures through
  service-worker routes.
- `postgres-pglite`: supports Postgres-shaped demos with SQL init or seed files
  through PGlite.
- `sqlite`: supports explicit SQLite services with SQL or database seed assets
  through sql.js.
- Unsupported: Docker builds, privileged containers, opaque volumes, arbitrary
  daemons, and Linux networking are unsupported in browser-only v1.

Unsupported does not mean impossible forever. It means there is no honest
browser adapter for that behavior yet.

## Readiness Report

Every analysis result includes:

- `readiness.status`: `ready`, `partial`, or `blocked`;
- `readiness.score`: percentage of services that are browser-native;
- service-level `unsupported` reasons;
- service-level `suggestions`;
- project-level `nextSteps`.

The goal is to make unsupported services actionable. For example, a Redis
service is reported as stateful browser-incompatible and points you toward
SQLite, PGlite, fixtures, or in-browser mock state for the demo.

## Labels

Use labels when PocketStack cannot safely infer intent:

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

`static-web` is autodetected from the image and document-root mounts. It is not
selected with `pocketstack.adapter`.

## Static Web

PocketStack copies files mounted at or below the image document root and
renders them in an iframe preview. It handles whole directories, single files
such as `index.html`, and common output folders such as `dist/`.

Root-relative URLs in packaged HTML/CSS such as `/assets/app.css` are rewritten
so the copied site still works from the generated demo path.

PocketStack does not emulate nginx/httpd/caddy redirects, rewrites, custom
headers, auth, compression, or other server configuration. Those cases produce
warnings instead of fake support.

## Frontend

Frontend services are meant for projects that can run from source in a browser
runtime. Autodetection requires a Node/Bun image plus `package.json`.
`pocketstack.adapter=frontend` can be used when the service image is not enough
to infer intent.

PocketStack packages the project root or the bind-mounted `working_dir`, keeps
simple `entrypoint`/`command` start behavior, and passes Compose
`environment:` plus `env_file:` values into the browser runtime. Required env
files must be present in the uploaded/generated project. Optional long-syntax
env files may be missing and are reported as warnings.

When frontend code points at a `mock-http` service with a Compose-style URL
such as `http://api:8080`, the generated runtime rewrites it to the static
demo's browser mock URL. PocketStack also injects service URL environment
variables such as `POCKETSTACK_API_URL` and `VITE_POCKETSTACK_API_URL`.

If a frontend needs PocketStack mock or database endpoints from inside the
preview iframe, the generator mounts a small bridge script into the project.
The bridge forwards only known PocketStack demo endpoints. It is not a general
network proxy.

## Mock HTTP

Mock services turn OpenAPI specs and JSON fixtures into static browser routes.
YAML parsing is bundled into the generated runtime, so packaged demos do not
need a parser CDN just to read local specs.

Supported mock features include:

- OpenAPI YAML or JSON;
- local `#/components/...` and path-item references;
- path templates and required query parameter examples/defaults;
- response status codes, headers, media types, and no-body responses;
- JSON fixture overrides;
- request-aware fixtures using `request.params`, `request.query`,
  `request.json`, `request.text`, or `bodyFrom: "request"`;
- CORS and preflight responses for frontend demos.

Fixture directories package `.json` files only. Other files are skipped with a
warning, and a fixtures-only mock must contain at least one JSON fixture.

## Browser Databases

`postgres-pglite` and `sqlite` adapters initialize browser databases from
packaged SQL or seed database assets. Generated demos include a stable storage
namespace so multiple PocketStack demos can share one static origin without
reusing the same IndexedDB keys.

Both adapters expose a demo-only query endpoint:

```text
/__pocketstack/db/<service>/query
```

Send `POST` JSON such as `{"sql":"select 1"}` to query the in-browser
database and receive adapter-native JSON. This is for demos and custom browser
UI. It is not a Postgres TCP server, Docker networking, or a backend proxy.

## PGlite Postgres

`postgres-pglite` can package SQL files from `pocketstack.db.init`,
`pocketstack.db.seed`, and local bind mounts under
`/docker-entrypoint-initdb.d`.

SQL files execute once for persisted databases and again after reset. Shell
scripts, compressed dumps, and other Docker entrypoint behavior are not run in
browser-only mode.

## SQLite

`sqlite` can package a single SQL file, a directory of `.sql` files, or a
binary `.db`, `.sqlite`, or `.sqlite3` seed file. SQL directories execute in
sorted order. Binary database seeds are loaded as the starting database image
rather than executed as SQL.

Frontend environments receive both URL and DB URL variables, for example
`POCKETSTACK_DB_URL`, `VITE_POCKETSTACK_DB_URL`,
`POCKETSTACK_DB_DB_URL`, and `VITE_POCKETSTACK_DB_DB_URL`.

## WASI

`wasi` supports prebuilt modules only. PocketStack does not compile source,
run Docker builds, or manufacture a WASI module from a container image.

The generated demo first tries built-in browser WASI preview imports for common
preview1 modules. If the module needs fuller WASI/WASIX behavior, it falls
back to Wasmer JS with the same argv and Compose environment values. That
fallback requires cross-origin isolation headers and public CDN access, but it
still does not use a PocketStack backend.
