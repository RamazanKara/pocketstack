# Compatibility Matrix

PocketStack v1 is browser-only. It supports Compose projects only when every service maps to an adapter below.

| Compose pattern | Adapter | Status |
| --- | --- | --- |
| `nginx`, `httpd`, or `caddy` serving bind-mounted local files or directories under the document root | `static-web` | Supported for document-root files; mounted server config is detected and warned, not emulated |
| Node/Bun frontend with `package.json` in the project root or a bind-mounted source directory, plus a Compose command, `dev` script, `start` script, or `pocketstack.frontend.start` label | `frontend` | Supported with npm/pnpm/yarn/bun detection, Compose environment variables, mock service URL rewriting, cross-origin isolation, binary-safe project assets, and resettable WebContainer lifecycle |
| Prebuilt WASM module referenced by `pocketstack.wasi.module` | `wasi` | Supported with argv, Compose environment, stdio, clock, random, empty preopen metadata imports, conservative stubs for common unused filesystem/socket imports, legacy `wasi_unstable` imports, and a Wasmer JS fallback |
| OpenAPI YAML/JSON file and optional JSON fixture directory | `mock-http` | Supported, including bundled YAML parsing, path templates, local component/path-item `$ref`s, required query parameter examples, response headers, media types, and no-body responses |
| `postgres` image with optional SQL init/seed files/directories or mounted `/docker-entrypoint-initdb.d/*.sql` files | `postgres-pglite` | Supported with one-time bootstrap, per-demo `indexeddb` or `memory` persistence, reset, and demo HTTP query bridge |
| Explicit SQLite service with optional SQL init/seed files, SQL init/seed directories, or `.db`/`.sqlite` seed file | `sqlite` | Supported with per-demo `indexeddb` or `memory` persistence, reset, and demo HTTP query bridge |
| Docker builds, privileged containers, arbitrary daemons, Linux networking, or opaque volume behavior | none | Unsupported |

Unsupported does not mean impossible forever. It means no honest browser adapter exists for that service yet.

## Mock HTTP

For `mock-http`, generated OpenAPI routes provide default/example responses
from inline schemas or local `#/components/...` references, including
OpenAPI 3.1 path item refs. Required query parameters with examples/defaults
are turned into browser mock query constraints. Fixture directories package
`.json` files only; non-JSON files are warned and skipped, and a fixtures-only
mock needs at least one JSON fixture. Fixture files with the same method and
path override the OpenAPI-generated route, and fixture paths may include query
constraints such as `/search?q=demo`.
YAML OpenAPI parsing is bundled into the generated runtime, so mock demos do
not need a parser CDN just to read packaged specs.
OpenAPI status codes, response headers, selected media types, and no-body
responses such as `204`, `205`, `304`, and `HEAD` are preserved.
Fixtures may also use `bodyFrom: "request"`, `request.params`,
`request.json`, `request.text`, or `request.query` for small dynamic
browser-only mock responses. Mock routes are registered automatically when the
demo loads and include CORS/preflight headers so WebContainer-hosted frontends
can fetch them from the generated static demo origin.

## Static Web

For `static-web`, PocketStack copies and previews regular files from mounts at
or below the image's document root, including common output directories such as
`dist/`. This supports whole root directories, single files such as
`index.html`, and subdirectories such as `assets/`. Root-relative URLs in
packaged HTML/CSS such as `/assets/app.css` are rewritten to paths relative to
the generated static preview location. It does not
emulate nginx/httpd/caddy redirects, rewrites, custom headers, auth,
compression, or other server configuration. `static-web` is autodetected from
the image and document-root mounts; it is not selected with
`pocketstack.adapter`.

## Frontend

For `frontend`, explicit `pocketstack.adapter=frontend` can package a
root-level `package.json` even when the Compose service has no Node/Bun image;
autodetection still requires a Node/Bun image. Compose `environment:` and
`env_file:` values are passed to WebContainer install and start processes.
Required `env_file` entries must be present in the project folder; long-syntax
entries with `required: false` may be missing and are skipped with a warning.
Host-shell interpolation and secrets are not resolved by PocketStack in
browser-only mode, and env file values are embedded into the generated static
demo. When `working_dir` points inside a bind mount, PocketStack uses that
subdirectory as the packaged frontend project root. Simple `entrypoint` and
`command` combinations are preserved as the WebContainer start command. If
that command already runs an install step, the generated demo skips
PocketStack's separate inferred install command. When a frontend environment
variable points at a `mock-http` service using a Compose-style URL such as
`http://api:8080`, the runtime rewrites it to the static demo's mock service
URL. It also injects `POCKETSTACK_<SERVICE>_URL` and
`VITE_POCKETSTACK_<SERVICE>_URL` for each mock service. Because WebContainer
previews run in their own iframe origin, PocketStack mounts a generated bridge
script into the project and injects it into packaged `.html`/`.htm` files when
browser mock or database services are present. It also exposes
`POCKETSTACK_BRIDGE_URL` and `VITE_POCKETSTACK_BRIDGE_URL` for apps that need
to import the bridge manually. The bridge forwards only known PocketStack
mock/database demo requests to the parent runtime; it is not a general network
proxy.

## Browser Databases

For browser database adapters, generated demos include a stable storage
namespace so multiple PocketStack demos with the same service names can share
one static origin without reusing the same IndexedDB keys. Generated demos also
expose a browser-only query bridge at
`/__pocketstack/db/<service>/query`; send `POST` JSON such as
`{"sql":"select 1"}` to run SQL against the in-browser adapter and receive
adapter-native JSON results. This bridge is for demos and custom browser UI;
it is not a Postgres TCP wire-protocol server or a substitute for arbitrary
Docker networking.

## WASI

For `wasi`, PocketStack first tries the built-in browser WASI preview imports.
Those cover common prebuilt preview1 modules without a heavier runtime. If a
module needs a fuller WASI/WASIX runtime, the generated demo falls back to
Wasmer JS and passes the same argv and Compose environment values. That
fallback requires cross-origin isolation headers and public CDN access, but it
does not use a PocketStack backend.

## SQLite

For `sqlite`, `pocketstack.db.init` and `pocketstack.db.seed` may point to a
single SQL file or to a directory of `.sql` files. Directory entries are copied
and executed in sorted order. Binary `.db`, `.sqlite`, and `.sqlite3` seed
files are still loaded as the starting database image rather than executed as
SQL. Frontend environments also receive `POCKETSTACK_<SERVICE>_URL`,
`VITE_POCKETSTACK_<SERVICE>_URL`, `POCKETSTACK_<SERVICE>_DB_URL`, and
`VITE_POCKETSTACK_<SERVICE>_DB_URL` for each browser database service.

## PGlite Postgres

For `postgres-pglite`, `pocketstack.db.init` and `pocketstack.db.seed` may
point to a single `.sql` file or to a directory of `.sql` files. PocketStack can
also package local bind mounts under `/docker-entrypoint-initdb.d` when they
contain `.sql` files. Shell scripts, compressed SQL dumps, and other Docker
entrypoint behaviors are not executed in browser-only mode and are reported as
warnings.
