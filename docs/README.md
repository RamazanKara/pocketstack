# PocketStack Docs

These docs are written for developers deciding whether PocketStack can turn a
Compose project into a useful live demo.

Start here:

- [Compatibility matrix](COMPATIBILITY.md): supported Compose patterns,
  labels, readiness reports, adapter behavior, and unsupported boundaries.
- [Browser-native conversion guide](CONVERSION_GUIDE.md): practical ways to
  reshape unsupported services into useful static demos.
- [Browser-only contract](BROWSER_ONLY.md): the promise PocketStack keeps when
  it says a demo is browser-native.
- [Static hosting](HOSTING.md): COOP/COEP, generated host config files, and
  network access expectations.
- [Website integration](WEBSITE_INTEGRATION.md): linking, iframe embedding,
  subpath hosting, and custom UI service URLs.

Then go deeper:

- [Architecture](ARCHITECTURE.md): analyzer, adapter registry, generated demo
  runtime, manifest shape, and where to extend the system.
- [Browser testing](BROWSER_TESTING.md): Chrome/Edge/Safari-class smoke checks
  for the public site and generated demos.
- [Release process](RELEASE.md): local checks, GoReleaser, checksums, and tag
  publishing.
- [Changelog](../CHANGELOG.md): version history at a glance.
- [v1.1.0 release notes](RELEASE_NOTES_v1.1.0.md): current release highlights
  and constraints.

PocketStack v1 is browser-only. Unsupported Compose features should remain
explicitly unsupported until an honest browser adapter exists for them.
