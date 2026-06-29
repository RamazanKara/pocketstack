# Hosting & Headers

A generated PocketStack demo is a static folder of browser artifacts. There is
no server, runner, or Docker daemon at demo time — so you can host the output on
any static web host: GitHub Pages, Netlify, Cloudflare Pages, Vercel, Azure
Static Web Apps, S3-compatible object storage, or your own web server.

This page is the **single source of truth for the COOP/COEP header values**. Any
other page that mentions cross-origin isolation links here rather than restating
the values.

## Deploy the output

Generate the demo:

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Upload the whole `pocketstack-demo/` directory. Keep these together:

- `index.html`
- `pocketstack.manifest.json`
- `app.js`
- `mock-sw.js`
- `assets/`
- any emitted host-config files (see below)

Generated demos use relative paths, so the folder can live at the site root or
under a subpath without changes. See
[website integration](/deploy/website-integration) for linking, embedding, and
subpath hosting.

## Cross-origin isolation

Some adapters require the browsing context to be **cross-origin isolated**. That
is enabled by two response headers:

| Header | Value |
| --- | --- |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |

These are needed by:

- **`frontend`** demos — the WebContainer-style runtime requires cross-origin
  isolation;
- **`wasi`** demos — when they fall back to the Wasmer JS runtime for fuller
  browser WASI/WASIX execution.

::: warning
Without these headers, frontend demos fail fast with a clear COOP/COEP message,
and the WASI Wasmer fallback cannot run. Demos that do not need isolation
(`static-web`, `mock-http`, `postgres-pglite`, `sqlite`) work without them.
:::

The generated `pocketstack.manifest.json` records whether isolation is required
in `hostRequirements.crossOriginIsolationRequired`, so a host or custom UI can
warn users before loading a header-dependent demo. See the
[manifest reference](/deploy/manifest).

## Emitted host-config files

When a demo needs cross-origin isolation, PocketStack writes host-config files
next to `index.html` so common static hosts apply the headers automatically:

| File | Host | Applies headers to |
| --- | --- | --- |
| `_headers` | Netlify, Cloudflare Pages | `/*` |
| `vercel.json` | Vercel | `/(.*)` |
| `staticwebapp.config.json` | Azure Static Web Apps | global headers |

If isolation is **not** required, none of these files are written.

`_headers` is a plain-text file:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

`vercel.json` and `staticwebapp.config.json` carry the same two header values in
each host's native JSON format.

::: tip
A host that does not understand any of these files must be configured manually
with the same two headers from the table above.
:::

## Host comparison

| Host | Custom headers | Good for |
| --- | --- | --- |
| Netlify | Yes (`_headers`) | Any demo, including `frontend`/WASI-fallback |
| Cloudflare Pages | Yes (`_headers`) | Any demo, including `frontend`/WASI-fallback |
| Vercel | Yes (`vercel.json`) | Any demo, including `frontend`/WASI-fallback |
| Azure Static Web Apps | Yes (`staticwebapp.config.json`) | Any demo, including `frontend`/WASI-fallback |
| Your own web server | Yes (manual) | Any demo, when you control response headers |
| GitHub Pages | **No** (project repos) | Static-web, mock, and browser-database demos that do **not** need COOP/COEP |

### The GitHub Pages limitation

GitHub Pages does not let project repositories set arbitrary response headers.
It cannot apply COOP/COEP, and the emitted host-config files are ignored.

What this means in practice:

- **Fine on GitHub Pages:** the public site, Studio, `static-web` demos,
  `mock-http` demos, and `postgres-pglite` / `sqlite` browser-database demos
  that do not require isolation.
- **Not fully functional on GitHub Pages:** `frontend` (WebContainer) demos and
  `wasi` demos that need the Wasmer JS fallback. Host those on a header-capable
  static host (Netlify, Cloudflare Pages, Vercel, Azure Static Web Apps, or your
  own server) for full behavior.

The public PocketStack site itself is built for GitHub Pages by
`.github/workflows/pages.yml`, which publishes Studio, selected generated demos,
docs links, and media assets.

## Network access at demo time

A static demo is still **backend-free**: no PocketStack server is involved.
However, some adapters load browser-only runtime packages or install npm
dependencies in the *viewer's* browser, so the browser may need internet access
to public package/runtime CDNs.

Adapters that can require network/CDN access at demo time:

- **`frontend`** — browser-time package installs and WebContainer runtime code;
- **`wasi`** — when the Wasmer JS fallback is needed;
- **`postgres-pglite`** and **`sqlite`** — browser database runtime packages.

The manifest records this in `hostRequirements.networkAccessRequired`. Runtime
packages loaded from public CDNs are version-pinned, so previously generated
demos do not break when an upstream package ships a new major.

::: info
For a demo that must work fully offline, prefer `static-web` and `mock-http`,
which do not pull runtime packages. See the [adapter matrix](/adapters/) for
which adapter fits each service.
:::
