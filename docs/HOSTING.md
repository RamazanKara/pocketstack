# Static Hosting

Generated PocketStack demos are static browser artifacts. Host the output
directory on GitHub Pages, Netlify, Cloudflare Pages, Vercel, Azure Static Web
Apps, S3-compatible object storage, or any static web server.

The public PocketStack site is built for GitHub Pages by `.github/workflows/pages.yml`.
It publishes Studio, selected generated demos, docs links, and media assets.

## Basic Deploy

Generate the demo:

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Upload the whole `pocketstack-demo/` directory. Keep `index.html`,
`pocketstack.manifest.json`, `app.js`, `mock-sw.js`, and `assets/` together;
generated demos use relative paths so they can live under a subpath.

## Cross-Origin Isolation

Frontend/WebContainer demos require:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

WASI demos also require those headers when they fall back to Wasmer JS.

When a generated demo needs cross-origin isolation, PocketStack writes host
config files with equivalent headers:

- `_headers` for Netlify and Cloudflare Pages;
- `vercel.json` for Vercel;
- `staticwebapp.config.json` for Azure Static Web Apps.

Hosts that do not understand those files must be configured manually with the
same headers.

GitHub Pages does not let project repositories set arbitrary response headers.
Use it for the public site, Studio, static-web demos, mock demos, and browser
database demos that do not require COOP/COEP. Host WebContainer or Wasmer
fallback demos on a header-capable static host for full behavior.

## Host Choice

Use GitHub Pages when you want a public preview, docs site, static-web demo,
mock demo, or browser database demo that does not need custom headers.

Use Netlify, Cloudflare Pages, Vercel, Azure Static Web Apps, or your own
server when a demo needs COOP/COEP. Those hosts can apply the generated config
files or equivalent manual headers.

## Network Access

Some adapters load browser-only runtime packages or install npm dependencies in
the viewer's browser. This is still backend-free: no PocketStack server is
used, but the browser may need internet access to public package/runtime CDNs.

Adapters that can require network access include:

- `frontend` for browser-time package installs and WebContainer runtime code;
- `wasi` when the Wasmer JS fallback is needed;
- `postgres-pglite` and `sqlite` for browser database runtime packages.

If you need a demo that also works offline, prefer `static-web` and
`mock-http`, or vendor the frontend/database runtime assets in a future adapter
before promising offline behavior.
