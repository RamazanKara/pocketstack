# Release

PocketStack v1 releases are published from tags.

```sh
git tag v1.0.0
git push origin main v1.0.0
```

The `release` workflow runs GoReleaser and publishes Linux, macOS, and Windows binaries for amd64 and arm64 with checksums.

Before tagging:

```sh
npm ci
npm run build:runtime
npm run test:runtime
go test ./...
go vet ./...
make smoke
goreleaser release --snapshot --clean --skip=publish
```
