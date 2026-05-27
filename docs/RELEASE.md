# Release

PocketStack v1 releases are published from Git tags.

Use this process when a commit is ready to become a downloadable GitHub
release. For docs-only changes that do not need binary artifacts, a normal
merge to `main` is enough.

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

Use a fresh semantic version and push the tag:

```sh
VERSION=v1.0.4
git tag "$VERSION"
git push origin main "$VERSION"
```

The GitHub `release` workflow runs GoReleaser and publishes Linux, macOS, and
Windows binaries for amd64 and arm64 with checksums.

## After Publish

Check the release before announcing it:

```sh
gh release view "$VERSION"
gh release download "$VERSION" --dir /tmp/pocketstack-release
cd /tmp/pocketstack-release
sha256sum -c checksums.txt
```

Also confirm the public Pages site if the release changed docs, Studio, public
examples, or generated demo behavior:

```sh
curl -L --fail https://ramazankara.github.io/pocketstack/
```
