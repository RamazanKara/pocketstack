# Contributing

PocketStack accepts changes that preserve the **browser-only contract**. This
page covers dev setup, the verify commands, and what a good contribution looks
like.

## The browser-only contract

Contributions must keep all of these true:

- no hidden backend;
- no remote runner fallback;
- no Docker daemon requirement at demo time;
- no claims that arbitrary Linux containers run in the browser.

Good contributions make the supported surface **clearer**. If a Compose feature
cannot be represented by a browser adapter, prefer a precise unsupported reason
over a partial demo that looks more compatible than it is.

## Prerequisites

- **Go** — to build the CLI and run `go test` / `go vet`.
- **Node 26** — the JavaScript toolchain targets Node 26. Use `nvm use` to
  select it (CI and release workflows pin `node-version: "26"`).

```sh
nvm use
```

## Repo layout

The pipeline is **compose (model) → analyzer → generator → embedded runtime**:

- `internal/compose` — Compose file model (types + `LoadFile`);
- `internal/analyzer` — adapter detection, readiness, suggestions, analysis
  types;
- `internal/generator` — static demo generation; embeds the built runtime at
  `internal/generator/runtime/`;
- `web/runtime` — the browser runtime TypeScript (`web/runtime/src/app.ts`),
  bundled by esbuild into `internal/generator/runtime/app.js`;
- `web/studio` — the in-browser Studio analyzer; `web/site` — the landing page;
- `cmd/pocketstack` — CLI entry point.

For the full picture, including the embedded-runtime build chain and extension
points, see the [architecture reference](/reference/architecture).

## Verify before opening a change

Run these before opening a pull request:

```sh
npm ci
npm run build:wasi-example
npm run build:runtime
npm run test:runtime
go test ./...
go vet ./...
make smoke
```

- `npm run build:runtime` rebuilds `internal/generator/runtime/app.js` from
  `web/runtime/src/app.ts`. Generated demos do not pick up runtime changes until
  you run it.
- `make smoke` builds the binary, regenerates every example demo, and runs the
  generated-demo checks.

::: tip
`make release-check` is the **full gate** — it additionally runs lint/`go vet`, a
GoReleaser snapshot build, and checksum verification. Run it before preparing a
release. See [releasing](/contribute/releasing).
:::

If your change touches the public site, Studio, or generated demo HTML/CSS/
runtime behavior, also run the [browser tests](/contribute/browser-testing).

## Adding a new adapter

A new adapter starts in the analyzer and flows through the pipeline (see
[architecture: extension points](/reference/architecture#extension-points-adding-an-adapter)).
It should add:

- analyzer classification tests;
- generated [manifest](/deploy/manifest) coverage;
- browser runtime tests;
- an example Compose project;
- documentation in the [adapter matrix](/adapters/) / compatibility docs;
- clear unsupported-feature reporting for nearby cases that still cannot work.

## Pull requests

Work on a branch and open a pull request against `main`. Note user-facing
changes in `CHANGELOG.md` under an `Unreleased` / next-version heading; the
[release process](/contribute/releasing) covers tagging and publishing.

## More

- [Releasing](/contribute/releasing) — the maintainer release process.
- [Browser testing](/contribute/browser-testing) — the public-site and demo
  smoke suite.
