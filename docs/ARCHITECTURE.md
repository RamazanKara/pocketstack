# Architecture

PocketStack is a browser-only Compose demo compiler. It has three main pieces:
the analyzer, the static demo generator, and the browser runtime.

## Analyzer

The analyzer reads a Compose file and classifies each service with the adapter
registry. A service is either `browser-native` or `unsupported`.

This is intentionally conservative. A false positive would create a misleading
demo, so adapters are allowlisted and unsupported services keep concrete
reasons in the analysis output.

Implemented adapters:

- `static-web`: copies document-root files from `nginx`, `httpd`, or `caddy`
  bind mounts and warns about server config that static hosting cannot emulate.
- `frontend`: packages a Node/Bun project for WebContainer-style browser
  execution, including env handling, package-manager detection, and bridge
  support for PocketStack mock/database endpoints.
- `wasi`: packages an explicitly labeled prebuilt `.wasm` module with browser
  WASI preview imports and a Wasmer JS fallback.
- `mock-http`: turns OpenAPI YAML/JSON and JSON fixtures into service-worker
  HTTP routes.
- `postgres-pglite`: maps supported Postgres demos to PGlite with SQL bootstrap,
  IndexedDB or memory persistence, reset, and query bridge support.
- `sqlite`: runs SQL init/seed assets or seed databases through sql.js in the
  browser.

## Generator

`pocketstack demo` writes a static directory:

- `index.html`
- `app.js`
- `mock-sw.js`
- `pocketstack.manifest.json`
- copied assets under `assets/<service>/`
- host config files when cross-origin isolation is required

The manifest is version `2`, sets `browserOnly: true`, carries service adapter
metadata, copied asset paths, generated warnings, host requirements, and a
stable storage namespace for browser database adapters.

Generation only succeeds when every service is browser-native. If any service
is unsupported, PocketStack exits with a reasoned incompatibility report
instead of falling back to a server.

## Runtime

Generated demos run as static browser code:

- static-web services render as iframe previews;
- frontend services boot in a WebContainer-style runtime;
- mock services register routes in `mock-sw.js`;
- database services initialize PGlite or SQLite on demand;
- WASI services execute prebuilt WebAssembly modules;
- logs, status, warnings, previews, reset controls, and query panels live in the
  generated dashboard.

The runtime may load public browser packages or npm dependencies when an
adapter requires them, but it does not call a PocketStack backend.
