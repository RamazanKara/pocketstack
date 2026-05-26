# PocketStack v1.0.1

PocketStack v1.0.1 is the first release-grade browser-only build.

Highlights:

- Browser-only Compose analyzer with adapter registry.
- Manifest v2 static app output with service dashboard, logs, status, start/reset controls, and host requirements.
- Static web, frontend/WebContainer, WASI, mock HTTP, PGlite Postgres, and SQLite adapters.
- Subpath-safe mock service-worker routing.
- Reproducible WASI hello-world example built from `hello.wat`.
- Cross-platform GoReleaser archives for Linux, macOS, and Windows on amd64 and arm64.

Known constraints:

- No backend, runner, Docker daemon, or full container runtime is included.
- Frontend/WebContainer demos require cross-origin isolation headers.
- Some browser adapters load public browser runtime packages or npm dependencies at demo time.
