# Website Integration

A PocketStack demo is a static folder. Any website can link to it, embed it in
an iframe, or host it under a route. The demo never calls a PocketStack backend,
so integration is just static-file hosting plus a link or an iframe.

Use a **link** when the demo deserves its own page. Use an **iframe** when the
demo is part of a docs page, announcement post, changelog, or product page.

## Generate and upload

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Upload the full `pocketstack-demo/` directory to your site or static host. Keep
the directory structure intact — the manifest, runtime, service worker, and
assets all use relative paths. For the deploy basics and header requirements,
see [hosting & headers](/deploy/hosting).

## Link

The simplest integration is a normal link:

```html
<a href="/demos/my-compose-demo/">Open live demo</a>
```

This gives the demo its own route, browser history, service-worker scope, and
full viewport.

## Embed in an iframe

```html
<iframe
  src="/demos/my-compose-demo/"
  title="PocketStack live demo"
  style="width: 100%; height: 720px; border: 0"
></iframe>
```

The iframe page is still a static PocketStack demo; it does not call a
PocketStack backend. Give the iframe enough height for the dashboard and preview
pane — `720px` is a good starting point for desktop docs pages. Verify the
height at both desktop and mobile widths.

## Host under a subpath

PocketStack demos are subpath-safe. All of these are valid:

```text
https://example.com/demo/
https://example.com/docs/demos/app/
https://example.com/releases/v1/pocketstack-demo/
```

Upload the whole generated folder under that route. Do not move individual files
out of the folder. If your website builder fingerprints or relocates assets,
configure it to copy the generated demo folder as a static directory.

### Documentation sites

For docs sites, copy the demo output into the published static directory, then
link or iframe it:

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

## Headers

Some adapters (`frontend`, and `wasi` when it falls back to Wasmer JS) require
cross-origin isolation headers, and PocketStack emits host-config files for
them. The required header values and per-host behavior — including the GitHub
Pages limitation — live in [hosting & headers](/deploy/hosting).

The generated `pocketstack.manifest.json` includes
`hostRequirements.crossOriginIsolationRequired`, so a custom website can warn
users before loading a header-dependent demo. See the
[manifest reference](/deploy/manifest).

## Driving service endpoints from custom UI

A generated demo exposes browser-only URLs that custom frontend code (sitting
next to the embedded demo) can call:

```text
/__pocketstack/mock/<service>/<route>
/__pocketstack/db/<service>/query
```

For example, a small query panel can post SQL to a database service:

```js
const response = await fetch("/__pocketstack/db/db/query", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sql: "select 1" }),
});
const payload = await response.json();
```

These endpoints exist only inside the generated browser demo and are served by a
service worker in the tab. They are **not** Docker networking, Postgres TCP, or
a general backend proxy. Use them for custom demo controls, fixture explorers,
or small query panels. For the full request/response shapes and more examples,
see [service URLs](/reference/service-urls).

## Integration checklist

Before publishing a demo from another website:

- Confirm `pocketstack.manifest.json` loads from the final URL.
- Open the generated dashboard and start each service.
- Check whether `hostRequirements.crossOriginIsolationRequired` is `true`; if
  so, host on a header-capable static host (see
  [hosting & headers](/deploy/hosting)).
- If embedding, verify the iframe height at desktop and mobile widths.
- Keep the demo folder intact when copying it through the site build.
