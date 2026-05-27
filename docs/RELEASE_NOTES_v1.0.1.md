# PocketStack v1.0.1

PocketStack v1.0.1 is the first release-grade browser-only build.

Highlights:

- Browser-only Compose analyzer with adapter registry.
- Manifest v2 static app output with service dashboard, logs, status,
  start/reset controls, and host requirements.
- Static web, frontend/WebContainer, WASI, mock HTTP, PGlite Postgres, and
  SQLite adapters.
- WASI runs through built-in browser preview imports first and can fall back to
  Wasmer JS for fuller browser WASI/WASIX execution.
- Mock HTTP services auto-register in generated demos, include CORS/preflight
  support, and rewrite frontend env URLs from Compose-style service URLs to
  browser mock URLs.
- PGlite and SQLite demos expose a browser-only HTTP query bridge for custom
  demo UI without claiming Postgres wire-protocol or Docker networking
  compatibility.
- WebContainer frontend demos mount a generated fetch bridge so preview iframes
  can reach known PocketStack mock/database endpoints through the parent
  browser runtime.
- The frontend bridge is injected into packaged HTML files and exposed with
  `POCKETSTACK_BRIDGE_URL` for custom import paths.
- Static web demos rewrite root-relative HTML/CSS asset URLs so copied sites
  keep working from the generated nested preview path.
- Subpath-safe mock service-worker routing.
- Cross-origin demos emit `_headers`, `vercel.json`, and `staticwebapp.config.json` hosting config.
- Studio supports pasted Compose YAML, uploaded Compose files, and optional
  project-folder uploads for browser-only triage.
- Live Studio/generated-demo announcement video and poster assets are included under `docs/media/`.
- Reproducible WASI hello-world example built from `hello.wat`.
- Cross-platform GoReleaser archives for Linux, macOS, and Windows on amd64 and arm64.

Known constraints:

- No backend, runner, Docker daemon, or full container runtime is included.
- Frontend/WebContainer demos require cross-origin isolation headers.
- Some browser adapters load public browser runtime packages or npm dependencies at demo time.
