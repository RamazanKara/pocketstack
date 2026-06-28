# Security

PocketStack generated artifacts are static browser applications. They do not
include a PocketStack backend, runner, or Docker daemon integration.

## Security Model

- The CLI reads local Compose projects and copies selected browser-safe assets
  into an output directory.
- Generated demos run in the viewer's browser and may use browser storage such
  as IndexedDB.
- Frontend/WebContainer demos and database/WASI adapters may load public
  browser runtime packages from version-pinned public CDNs (esm.sh, jsDelivr,
  unpkg, cdnjs). These are pinned to a major/known version but are not currently
  served with Subresource Integrity, so a CDN compromise would affect demos that
  load that adapter. Vendor the runtime assets if you need a hardened offline
  build.
- Unsupported container features remain unsupported instead of being emulated
  unsafely.

Generated demos can expose whatever files you package into them. Review copied
assets, fixtures, SQL seeds, environment values, and frontend source before
publishing a demo to a public host. Service names and OpenAPI route paths are
escaped before they are rendered in the demo dashboard.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.1.x   | ✅        |
| < 1.1   | ❌        |

Security fixes land on the latest minor release. Upgrade to the newest release
before reporting an issue.

## Reporting

Please report security issues privately using GitHub's private vulnerability
reporting at
<https://github.com/ramazankara/pocketstack/security/advisories/new>
(repository **Security** tab → **Report a vulnerability**). Do not open a public
issue for a suspected vulnerability.

You can expect an acknowledgement within a few days. Please include reproduction
steps and the affected version, and allow a reasonable window for a fix before
any public disclosure.
