# PocketStack Docs

Start with the contract, then move into adapter details:

- [Browser-only contract](BROWSER_ONLY.md): what PocketStack will and will not
  claim.
- [Compatibility matrix](COMPATIBILITY.md): supported Compose patterns,
  labels, and adapter limits.
- [Architecture](ARCHITECTURE.md): analyzer, adapter registry, generated demo
  runtime, and manifest shape.
- [Static hosting](HOSTING.md): COOP/COEP, generated host config files, and
  network access expectations.
- [Website integration](WEBSITE_INTEGRATION.md): linking, iframe embedding,
  subpath hosting, and custom UI service URLs.
- [Browser testing](BROWSER_TESTING.md): Chrome/Edge/Safari-class smoke checks
  for the public site and generated demos.
- [Release process](RELEASE.md): local checks, GoReleaser, checksums, and tag
  publishing.
- [v1.0.1 release notes](RELEASE_NOTES_v1.0.1.md): current release highlights
  and constraints.

PocketStack v1 is browser-only. Unsupported Compose features should remain
explicitly unsupported until an honest browser adapter exists for them.
