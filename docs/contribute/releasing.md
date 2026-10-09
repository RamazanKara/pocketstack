# Local release preparation

Build and verify release artifacts locally. The repository keeps a single
`ci` workflow for build, lint, and tests; local checks are the release gate
when GitHub Actions is unavailable. Pages can be assembled with `make pages`.

## Prerequisites

Use the latest Go 1.26 patch, Node 26, GNU Make, and the existing npm
dependencies. Staticcheck 2026.2 cannot yet read Go 1.27 export data.
On Windows, put GNU Make and Git Bash's utilities on PATH.
Install the analysis tools and keep the Go binary install directory on PATH:

```sh
npm ci
go install honnef.co/go/tools/cmd/staticcheck@latest
go install golang.org/x/vuln/cmd/govulncheck@latest
```

The existing Action integration fixtures require Linux or WSL because they
execute Unix shebang scripts. Run those tests there if preparing on Windows.
See [contributing](/contribute/) for the rest of the development setup.

## Local gate

```sh
make release-check
```

This runs the build, Go/runtime/Action tests, formatting checks, `go vet`,
Staticcheck, govulncheck, bounded parser fuzzing, all generated-demo smoke
checks, six release builds, and checksum verification. Go race tests run only
when cgo is enabled (`go env CGO_ENABLED` reports `1`); otherwise record that
they were skipped. govulncheck needs access to the Go vulnerability database.

To run checks separately:

```sh
make build lint test
make fuzz smoke
npm run docs:build
make release-local
make verify-checksums
```

Record actual failures or unavailable checks before handing off artifacts.

## Binaries and SHA256SUMS

`make release-local` builds the embedded runtime and uses
`go build -trimpath -buildvcs=false` with `CGO_ENABLED=0` for these six
standalone binaries:

```text
dist/release/pocketstack_linux_amd64
dist/release/pocketstack_linux_arm64
dist/release/pocketstack_darwin_amd64
dist/release/pocketstack_darwin_arm64
dist/release/pocketstack_windows_amd64.exe
dist/release/pocketstack_windows_arm64.exe
dist/release/SHA256SUMS
```

The version comes from `git describe --tags --always --dirty`, so local tracked
changes are visible in `pocketstack version`. Cross-building verifies compilation;
execute each binary on its target platform before claiming runtime coverage.

`make verify-checksums` recomputes SHA-256 for every binary in `SHA256SUMS` and
fails if a file is missing or differs. It works on Windows, macOS, and Linux
using the project's existing Node runtime. Standard checksum tools can also
verify the manifest from `dist/release`:

```sh
sha256sum -c SHA256SUMS
# macOS:
shasum -a 256 -c SHA256SUMS
```

Run the host binary as a final smoke check. For example, on Windows:

```powershell
.\dist\release\pocketstack_windows_amd64.exe version
.\dist\release\pocketstack_windows_amd64.exe analyze -f examples/static-site/compose.yaml --format markdown
```

These targets only prepare local artifacts. Publishing and tagging are separate
maintainer actions. `make release-dry-run` remains available for maintainers
with GoReleaser installed; its snapshot archives and `dist/checksums.txt` are
separate from the standalone binaries and `dist/release/SHA256SUMS` above.
