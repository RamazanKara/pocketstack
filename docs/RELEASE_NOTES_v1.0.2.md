# PocketStack v1.0.2

PocketStack v1.0.2 publishes the browser-only release as a live public site and
keeps the release artifacts aligned with the demo experience.

Highlights:

- Public GitHub Pages site at `https://ramazankara.github.io/pocketstack/`.
- Hosted Studio, live generated demos, announcement video, and demo index.
- Three upload-ready example projects for Studio testing: static web,
  OpenAPI mock HTTP, and SQLite.
- Website integration docs for links, iframes, subpath hosting, headers, and
  browser-only service URLs.
- Chrome, Microsoft Edge, and Safari-class WebKit smoke checks in CI.
- Project JavaScript tooling targets Node 26, and GitHub Actions are refreshed
  to current Node 24 action runtimes where available.
- GoReleaser archives now include docs, examples, and Studio assets.

Known constraints:

- No backend, runner, Docker daemon, or full container runtime is included.
- GitHub Pages cannot set arbitrary COOP/COEP headers; WebContainer and Wasmer
  fallback demos should use a header-capable static host for full behavior.
- Some adapters load public browser runtime packages or npm dependencies at
  demo time.
