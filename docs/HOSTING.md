# Static Hosting

Generated PocketStack demos are static browser artifacts. They can be hosted on static hosts such as GitHub Pages, Netlify, Cloudflare Pages, S3-compatible object storage, or any static web server.

## Cross-Origin Isolation

Frontend/WebContainer demos require these headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

When a generated demo requires them, PocketStack emits a Netlify-style `_headers` file:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

Hosts that do not understand `_headers` must be configured with equivalent headers.

## Network Access

Some adapters load browser-only runtimes from public CDNs or install npm dependencies inside the browser. This is still backend-free: no PocketStack server is used, but the viewer's browser may need internet access.
