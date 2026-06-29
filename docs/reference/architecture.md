# Architecture

PocketStack is a browser-only Compose demo compiler: a Go CLI converts a
browser-compatible Docker Compose project into a static folder that runs
entirely in a browser tab, plus a TypeScript browser runtime that is bundled and
embedded into the CLI. There is no server, runner, or Docker daemon at demo time.

Read this page to understand where a behavior belongs, how the embedded runtime
is built, or how to add a new adapter without weakening the browser-only
contract.

## Pipeline

```text
compose.yaml + project files
        |
        v
 internal/compose   (model: types + LoadFile)
        |
        v
 internal/analyzer  (adapter detection, readiness, suggestions)
        |
        v
 internal/generator (static demo + embedded runtime)
        |
        v
 index.html + app.js + mock-sw.js + pocketstack.manifest.json + assets/
        |
        v
 browser runtime dashboard (in the viewer's tab)
```

The CLI entry point is `cmd/pocketstack`. The pipeline is:
**compose (model) → analyzer → generator → embedded browser runtime.**

## Packages

### `internal/compose` — the Compose model

Owns the Compose file **model**: the service/project types and `LoadFile`, which
reads and parses a single Compose file into those types. It is parsing and data
structures only — no adapter logic or browser concerns.

### `internal/analyzer` — analysis

Reads the Compose model and classifies each service against the adapter
registry. It owns the analysis types (`Analysis`, `ServiceAnalysis`,
`AssetAnalysis`, `Readiness`, `HostRequirements`) and the `AnalyzeFile` /
`Analyze` entry points.

A service is either **browser-native** (mapped to an adapter) or **unsupported**;
there is no server-fallback state. This is intentionally conservative — a false
positive would create a misleading demo, so adapters are allowlisted and
unsupported services keep concrete reasons in the analysis output. The analyzer
also produces a readiness score, per-service suggestions, and project next steps
so unsupported stacks still get a useful conversion plan.

Implemented adapters:

- **`static-web`** — copies document-root files from `nginx`, `httpd`, or
  `caddy` bind mounts; warns about server config static hosting cannot emulate.
- **`frontend`** — packages a Node/Bun project for WebContainer-style browser
  execution, including env handling, package-manager detection, and bridge
  support for PocketStack mock/database endpoints.
- **`wasi`** — packages an explicitly labeled prebuilt `.wasm` module with
  browser WASI preview imports and a Wasmer JS fallback.
- **`mock-http`** — turns OpenAPI YAML/JSON and JSON fixtures into
  service-worker HTTP routes.
- **`postgres-pglite`** — maps supported Postgres demos to PGlite with SQL
  bootstrap, IndexedDB or memory persistence, reset, and query-bridge support.
- **`sqlite`** — runs SQL init/seed assets or seed databases through sql.js in
  the browser.

See the [adapter matrix](/adapters/) for how each is selected and the
[conversion guide](/convert/) for reshaping unsupported services. New adapter
behavior is decided here first: the analyzer must be able to explain *why* a
service is supported, *what* files to copy, *what* host requirements apply, and
*what* warnings the demo should show.

### `internal/generator` — static demo generation

`pocketstack demo` runs the analyzer, and **only succeeds when every service is
browser-native**. If any service is unsupported, it exits with a reasoned
incompatibility report instead of falling back to a server.

When generation succeeds, it writes a static directory:

- `index.html`
- `app.js` (the embedded browser runtime)
- `mock-sw.js` (the mock service worker)
- `pocketstack.manifest.json`
- copied assets under `assets/<service>/`
- host-config files when cross-origin isolation is required

The generator makes demos **portable**: assets are copied into deterministic
service folders, root-relative static-site references are rewritten so copied
sites work from a nested path, and host-config files are emitted when an adapter
requires cross-origin isolation. The manifest is version `2`, sets
`browserOnly: true`, and carries adapter metadata, readiness, copied asset
paths, warnings, host requirements, and a stable storage namespace for browser
databases. See the [manifest reference](/deploy/manifest).

## The embedded runtime build chain

The browser runtime is TypeScript that lives in `web/runtime`. It is bundled by
esbuild and embedded into the generator binary, so a released CLI is
self-contained and writes the same runtime into every demo.

```text
web/runtime/src/app.ts
        |  esbuild --bundle --format=esm --target=es2022
        v
internal/generator/runtime/app.js
        |  //go:embed runtime/*
        v
embedded into the pocketstack binary
        |  generator writes it next to index.html
        v
app.js in every generated demo
```

The bundle command (from `package.json`) is:

```sh
npm run build:runtime
# esbuild web/runtime/src/app.ts --bundle --format=esm --target=es2022 \
#   --outfile=internal/generator/runtime/app.js
```

`internal/generator/runtime/` also holds `mock-sw.js`, the mock service worker.
The generator embeds the whole `runtime/` directory with `//go:embed runtime/*`
and copies each file into the output during generation.

::: warning
Editing `web/runtime/src/*.ts` does **not** change generated demos until you run
`npm run build:runtime` to regenerate `internal/generator/runtime/app.js`. The
Go embed reads the built artifact, not the TypeScript source. CI and
`make release-check` rebuild it before testing.
:::

## Other web surfaces

Two web apps are built from the same repo but are not embedded in the CLI:

- **`web/studio`** — the in-browser Studio analyzer (paste/upload a Compose file
  for browser-only triage).
- **`web/site`** — the landing page.

These ship to the public GitHub Pages site alongside selected generated demos.

## Runtime behavior

Generated demos run as static browser code:

- `static-web` services render as iframe previews;
- `frontend` services boot in a WebContainer-style runtime;
- `mock-http` services register routes in `mock-sw.js`;
- database services initialize PGlite or SQLite on demand;
- `wasi` services execute prebuilt WebAssembly modules;
- logs, status, warnings, previews, reset controls, and query panels live in the
  generated dashboard.

The runtime may load public browser packages or npm dependencies when an adapter
requires them, but it never calls a PocketStack backend. Custom UI can drive the
demo through browser-only [service URLs](/reference/service-urls).

## Extension points: adding an adapter

A new adapter starts in `internal/analyzer` and flows through the pipeline:

1. **Analyzer** — add classification: detect the service, declare which files to
   copy (as `AssetAnalysis`), set `HostRequirements`, and emit clear `warnings`
   and `unsupported` reasons for nearby cases that still cannot work.
2. **Generator** — ensure the copied assets and `config` keys the runtime needs
   land in the manifest (see how `copyServiceAssets` maps asset names to config
   in `internal/generator/generator.go`).
3. **Runtime** — implement the browser behavior in `web/runtime/src` and rebuild
   with `npm run build:runtime`.
4. **Tests & docs** — analyzer classification tests, manifest coverage, runtime
   tests, an example Compose project, and an adapter page under `/adapters/`.

Keep new behavior **adapter-shaped**. If a feature needs Docker networking,
privileged filesystem access, or a long-running server that is not a browser
primitive, it belongs in the unsupported report until there is a real browser
implementation. The full checklist is in the
[contributing guide](/contribute/).
