# Website Integration

PocketStack demos are static folders. Any website can link to them, embed them,
or host them under a route.

## Generate

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Upload the full `pocketstack-demo/` directory to your website or static host.
Keep the directory structure intact; the manifest, runtime, service worker, and
assets use relative paths.

## Link

The lowest-friction integration is a normal link:

```html
<a href="/demos/my-compose-demo/">Open live demo</a>
```

Use this when the demo should get its own page and browser history.

## Embed

You can embed a demo in an iframe:

```html
<iframe
  src="/demos/my-compose-demo/"
  title="PocketStack live demo"
  style="width: 100%; height: 720px; border: 0"
></iframe>
```

The iframe page is still a static PocketStack demo. It does not call a
PocketStack backend.

## Host Under a Subpath

PocketStack demos are subpath-safe. These are all valid:

```text
https://example.com/demo/
https://example.com/docs/demos/app/
https://example.com/releases/v1/pocketstack-demo/
```

Upload the whole generated folder under that route. Do not move individual
files out of the folder.

## Headers

Some adapters need cross-origin isolation:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

PocketStack emits `_headers`, `vercel.json`, and
`staticwebapp.config.json` when those headers are required.

Hosts that support custom headers:

- Netlify
- Cloudflare Pages
- Vercel
- Azure Static Web Apps
- your own static web server

GitHub Pages is useful for public static previews and docs, but it does not let
project repositories set arbitrary response headers. Demos that require
COOP/COEP should be hosted on a header-capable static host for full behavior.

## Service URLs For Custom UI

Generated demos expose browser-only URLs that custom frontend code can call:

```text
/__pocketstack/mock/<service>/<route>
/__pocketstack/db/<service>/query
```

Database query endpoint example:

```js
const response = await fetch("/__pocketstack/db/db/query", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sql: "select 1" }),
});
const payload = await response.json();
```

These endpoints exist only inside the generated browser demo. They are not
Docker networking, Postgres TCP, or a general backend proxy.

## Embed In Documentation Sites

For docs sites, copy the demo output into the published static directory:

```text
docs-site/
  index.html
  demos/
    my-compose-demo/
      index.html
      pocketstack.manifest.json
      app.js
      mock-sw.js
      assets/
```

Then link or iframe `/demos/my-compose-demo/`.
