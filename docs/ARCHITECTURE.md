# Architecture

PocketStack is a browser-only Compose demo compiler.

It has three layers:

## Analyzer

The analyzer reads a Compose file and classifies every service as:

- `browser-native` when a service has a supported browser adapter.
- `unsupported` when the service needs semantics the browser cannot provide yet.

The analyzer is intentionally conservative. A false positive would create a misleading demo, so adapters are allowlisted.

## Adapters

Adapters translate Compose service intent into browser primitives.

Implemented in v1:

- `static-web`: copies a local document root mounted into `nginx`, `httpd`, or `caddy`.
- `frontend`: packages a mounted Node/Bun project for an in-browser WebContainer runtime.
- `wasi`: packages an explicitly labeled prebuilt `.wasm` module.
- `mock-http`: packages OpenAPI metadata and JSON fixtures for browser service-worker mocks.
- `postgres-pglite`: maps supported Postgres demos to PGlite.
- `sqlite`: maps explicitly labeled SQLite demos to sql.js/sqlite-wasm.

## Static Demo Generator

The generator writes:

- `index.html`
- `app.js`
- `mock-sw.js`
- `pocketstack.manifest.json`
- copied browser assets under `assets/<service>/`

Generation succeeds only when every service is browser-native. If any service is unsupported, PocketStack exits with a reasoned incompatibility report instead of falling back to a server.
