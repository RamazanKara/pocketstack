# Release

PocketStack v1 releases are published from tags. Use a fresh semantic version for each release.

```sh
git tag v1.0.1
git push origin main v1.0.1
```

The `release` workflow runs GoReleaser and publishes Linux, macOS, and Windows binaries for amd64 and arm64 with checksums.

Before tagging:

```sh
npm ci
npm run build:wasi-example
npm run build:runtime
npm run test:runtime
go test ./...
go vet ./...
make smoke
goreleaser release --clean --skip=publish
```

If GitHub publishing is unavailable, the same GoReleaser command with `--skip=publish` produces complete local archives and `checksums.txt` under `dist/`.
