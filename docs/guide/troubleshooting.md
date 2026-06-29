# Troubleshooting

Common questions and errors when analyzing Compose files and running generated demos, with fixes.

## A demo looks empty when opened from `file://`

A `static-web` demo previews fine when you double-click `index.html`, but adapters that use a **service worker** (mock HTTP, browser databases, the frontend runtime) need an `http(s)` origin — browsers don't register service workers on `file://`. Serve the folder instead of opening the file:

```sh
npx serve pocketstack-demo
```

Any static server works (`python3 -m http.server`, a local dev server, or your real host). See [hosting](/deploy/hosting).

## "frontend demo needs cross-origin isolation"

`frontend`/WebContainer demos — and `wasi` demos when they fall back to Wasmer JS — require cross-origin isolation, which means the host must send COOP/COEP response headers. When a generated demo needs them, PocketStack writes the matching host config files next to the demo (`_headers`, `vercel.json`, `staticwebapp.config.json`).

::: warning
GitHub Pages can't set arbitrary response headers, so it can't serve a demo that needs cross-origin isolation. Use a header-capable host (Netlify, Cloudflare Pages, Vercel, Azure Static Web Apps, or your own server) and let it apply the generated config — or set the headers manually. The exact header values and per-host details are in [hosting](/deploy/hosting).
:::

## A demo that loads from a CDN fails offline

Some adapters fetch browser-only runtime packages (or install npm dependencies) **in the viewer's browser**. This is still backend-free — no PocketStack server is involved — but the browser needs internet access to public package/runtime CDNs. Adapters that can require network access:

- `frontend` — browser-time package installs and the WebContainer runtime;
- `wasi` — only when the Wasmer JS fallback is used;
- `postgres-pglite` and `sqlite` — browser database runtime packages.

::: tip Need offline?
Prefer `static-web` and `mock-http` for demos that must work without network access — they package everything they need into the output.
:::

## "My service is reported unsupported"

This is by design, not a bug: PocketStack won't fake a service it can't represent honestly in the browser. Read the readiness report — each unsupported service prints concrete `reasons` and one or more `suggestions`:

```text
  cache: unsupported in browser-native mode
    - stateful service has no honest browser adapter
    suggestion: replace with SQLite, PGlite, fixtures, or in-browser mock state
```

Run `pocketstack analyze -f compose.yaml` to see them, then reshape the service into a browser-native form. The [convert a service](/convert/) guide walks through the common conversions (databases to PGlite/SQLite, APIs to `mock-http`, and so on).

## Compose parsing questions

A few Compose details that are handled automatically, so you don't need to work around them:

- **Port ranges** like `3000-3005:3000-3005` are accepted. The first port of the range is used, and adapter selection does not depend on the exact port.
- **Image name variants** are normalized. Short names (`postgres`), Docker Hub official names (`library/postgres`), and registry-qualified names (`docker.io/library/postgres:16`, `ghcr.io/org/app`) all resolve to the same adapter.
- **`profiles:`** — services gated behind a profile aren't started by a default `docker compose up`, so PocketStack skips them. They don't count toward or block readiness, and you'll see a warning that services were skipped.

::: info Not handled automatically
`extends:` is not resolved, and multiple Compose files / overrides aren't merged. Flatten the service (inline its image, labels, ports, and volumes) and pass a single file with `-f`. See [adapters](/adapters/) for per-adapter limits.
:::

## Getting more detail

Add `--json` to `analyze` for the full machine-readable analysis, including `readiness`, per-service `unsupported`/`suggestions`, `warnings`, `nextSteps`, and `hostRequirements`:

```sh
pocketstack analyze -f compose.yaml --json
```

See the [CLI reference](/guide/cli) for the complete output shape and exit codes.
