# Release

PocketStack v1 releases are published from Git tags.

## Local Gate

Run the full local gate before tagging:

```sh
nvm use
make release-check
```

That target runs Go tests, runtime tests, `go vet`, generated-demo smoke tests,
a GoReleaser snapshot, and checksum verification.

The Node toolchain targets Node 26; CI and release workflows use
`actions/setup-node` with `node-version: "26"`.

The individual commands are:

```sh
npm ci
npm run build:wasi-example
npm run build:runtime
npm run test:runtime
go test ./...
go vet ./...
make smoke
make release-dry-run
make verify-checksums
```

`make release-dry-run` produces snapshot archives and `checksums.txt` under
`dist/`.

## Publish

Use a fresh semantic version:

```sh
git tag v1.0.2
git push origin main v1.0.2
```

The GitHub `release` workflow runs GoReleaser and publishes Linux, macOS, and
Windows binaries for amd64 and arm64 with checksums.
