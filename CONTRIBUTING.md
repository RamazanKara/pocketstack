# Contributing

PocketStack accepts changes that preserve the browser-only contract:

- no hidden backend
- no remote runner fallback
- no Docker daemon requirement at demo time
- no claims that arbitrary Linux containers run in the browser

Good contributions make the supported surface clearer. If a Compose feature
cannot be represented by a browser adapter, prefer a precise unsupported reason
over a partial demo that looks more compatible than it is.

Before opening a change:

```sh
npm ci
npm run build:wasi-example
npm run build:runtime
npm run test:runtime
go test ./...
go vet ./...
make smoke
```

`make smoke` builds the binary, regenerates every example demo, and runs the
generated-demo checks. `make release-check` additionally runs `go vet`, a
GoReleaser snapshot build, and checksum verification — run it before preparing a
release.

Work on a branch and open a pull request against `main`. Note user-facing
changes in [CHANGELOG.md](CHANGELOG.md) under an `Unreleased`/next-version
heading; the [release process](docs/RELEASE.md) covers tagging and publishing.

New adapters should add:

- analyzer classification tests;
- generated manifest coverage;
- browser runtime tests;
- an example Compose project;
- documentation in the compatibility matrix;
- clear unsupported-feature reporting for nearby cases that still cannot work.
