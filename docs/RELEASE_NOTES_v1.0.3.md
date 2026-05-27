# PocketStack v1.0.3

PocketStack v1.0.3 refocuses the product around browser-native readiness
instead of pretending full Docker Compose compatibility can exist inside a
browser tab.

Highlights:

- `pocketstack analyze` now reports browser-readiness status, score, service
  blockers, service suggestions, and project next steps.
- Unsupported services now produce more useful primary reasons instead of a
  noisy list of every adapter rejection.
- Studio shows readiness score and conversion suggestions directly in the
  browser.
- Generated manifests include readiness metadata and project next steps.
- New browser-native conversion guide for replacing common unsupported
  services such as Redis, workers, backend APIs, Docker builds, and non-browser
  databases with demo-safe browser-native representations.
- Public site links to the conversion guide.

Known constraints:

- PocketStack remains browser-native only.
- It does not run arbitrary Docker containers, Docker builds, Linux daemons, or
  real container networking in the browser.
- Unsupported services should be converted to static assets, frontend projects,
  WASI modules, OpenAPI mocks, SQLite, PGlite, or in-browser state when that is
  honest for the demo.
