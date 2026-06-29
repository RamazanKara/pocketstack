# Changelog

All notable changes to PocketStack are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-release detail lives under [docs/release-notes/](docs/release-notes/index.md).

## [1.1.0] - 2026-06-28

### Added
- `extends:` services are reported as an explicit, actionable blocker with a
  suggestion to flatten the service.
- `pocketstack analyze` prints project-level warnings (COOP/COEP, network
  access, skipped profile services) in its default human-readable output.
- "Compose Features" documentation; `SECURITY.md` supported-versions table and
  private vulnerability reporting channel.
- CLI tests and regression tests for port ranges, image normalization, profile
  skipping, `extends`, and the WASI UTF-8 fix.

### Changed
- Services gated behind `profiles:` are skipped to match a default
  `docker compose up`; they no longer count toward or block readiness.
- Browser runtime packages (WebContainer, PGlite, sql.js, Wasmer) loaded from
  public CDNs are version-pinned.
- The GitHub Pages build skips missing demos/media with a warning instead of
  failing.

### Fixed
- Port ranges such as `3000-3005:3000-3005` no longer abort analysis.
- Registry-qualified and Docker Hub official image names
  (`docker.io/library/postgres:16`, `library/postgres`, `ghcr.io/org/app`) now
  resolve to the correct adapter.
- WASI `fd_write` decodes UTF-8 sequences split across iovec boundaries instead
  of corrupting them.
- The PGlite query panel and bridge use `exec` so multi-statement SQL
  (`insert …; select …;`) runs, matching the SQLite adapter.

### Security
- The generated demo dashboard escapes service names and OpenAPI route data
  before rendering, preventing HTML/script injection from untrusted input.
- PocketStack Studio sandboxes its uploaded-HTML preview iframe.
- Frontend, mock-http, database, and WASI demos now surface honest failure
  messages for missing cross-origin isolation, `file://` hosting, and CDN load
  failures.

## [1.0.3] - 2026-05-27
Refocused the product around browser-native readiness: `analyze` reports a
readiness score, blockers, suggestions, and next steps; clearer primary
unsupported reasons; conversion guide. See
[release notes](docs/release-notes/v1.0.3.md).

## [1.0.2] - 2026-05-27
Hosted Studio, generated example demos, and the GitHub Pages site. See
[release notes](docs/release-notes/v1.0.2.md).

## [1.0.1] - 2026-05-26
Hardening release. See [release notes](docs/release-notes/v1.0.1.md).

## [1.0.0] - 2026-05-26
Initial browser-native PocketStack release.

[1.1.0]: https://github.com/ramazankara/pocketstack/releases/tag/v1.1.0
[1.0.3]: https://github.com/ramazankara/pocketstack/releases/tag/v1.0.3
[1.0.2]: https://github.com/ramazankara/pocketstack/releases/tag/v1.0.2
[1.0.1]: https://github.com/ramazankara/pocketstack/releases/tag/v1.0.1
[1.0.0]: https://github.com/ramazankara/pocketstack/releases/tag/v1.0.0
