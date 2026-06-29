# Static Web

The `static-web` adapter serves static sites from `nginx`, `httpd`, or `caddy`
services. PocketStack copies the document-root files into the generated demo and
renders them in an iframe preview.

## How it's selected

`static-web` is **autodetected** — it is the only adapter not chosen with
`pocketstack.adapter`. PocketStack detects it from a supported image
(`nginx`, `httpd`, or `caddy`) plus a mount at or below the image's document
root.

```yaml
services:
  web:
    image: nginx:alpine
    volumes:
      - ./dist:/usr/share/nginx/html:ro
```

## What it packages

PocketStack copies files mounted at or below the image document root and renders
them in the preview. It handles:

- whole directories;
- single files such as `index.html`;
- common output folders such as `dist/`.

Root-relative URLs in packaged HTML/CSS — such as `/assets/app.css` — are
rewritten so the copied site still works from the generated demo path.

## What is not emulated

PocketStack copies files; it does not run a web server. It does **not** emulate
nginx/httpd/caddy:

- redirects;
- rewrites;
- custom headers;
- auth;
- compression;
- other server configuration.

::: warning
These cases produce warnings instead of fake support. If your demo depends on
server-side behavior (a rewrite rule, an auth gate, a custom header), that
behavior will not be present in the static copy.
:::
