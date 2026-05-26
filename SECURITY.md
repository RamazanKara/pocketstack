# Security

PocketStack generated artifacts are static browser applications. They do not include a PocketStack backend, runner, or Docker daemon integration.

Security model:

- The CLI reads local Compose projects and copies selected browser-safe assets into an output directory.
- Generated demos run in the viewer's browser and may use browser storage such as IndexedDB.
- Frontend/WebContainer demos and database/WASI adapters may load public browser runtime packages from the network.
- Unsupported container features remain unsupported instead of being emulated unsafely.

Report security issues privately through the GitHub repository once releases are published.
