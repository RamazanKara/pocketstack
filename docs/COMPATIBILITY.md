# Compatibility Matrix

PocketStack v1 is browser-only. It supports Compose projects only when every service maps to an adapter below.

| Compose pattern | Adapter | Status |
| --- | --- | --- |
| `nginx`, `httpd`, or `caddy` serving a bind-mounted local directory | `static-web` | Supported |
| Node/Bun frontend with bind-mounted `package.json` and `dev` or `start` script | `frontend` | Supported with cross-origin isolation |
| Prebuilt WASM module referenced by `pocketstack.wasi.module` | `wasi` | Supported |
| OpenAPI file and JSON fixture directory | `mock-http` | Supported |
| `postgres` image with optional SQL init/seed files | `postgres-pglite` | Supported |
| Explicit SQLite service with optional SQL init/seed files | `sqlite` | Supported |
| Docker builds, privileged containers, arbitrary daemons, Linux networking, or opaque volume behavior | none | Unsupported |

Unsupported does not mean impossible forever. It means no honest browser adapter exists for that service yet.
