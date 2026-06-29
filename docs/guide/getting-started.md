# Getting Started

PocketStack is a Go CLI and browser runtime that turns browser-compatible Docker Compose projects into static, browser-native demos that run entirely in a browser tab. When a service can't be represented honestly in the browser, it reports a readiness score and conversion suggestions instead of faking it.

## Install

Download the prebuilt binary from GitHub Releases, or build from source. See [installation](/guide/installation) for both paths and prerequisites. Verify your install with:

```sh
pocketstack version
```

::: tip No-install option
You can skip the CLI entirely for a quick compatibility check. [Studio](https://ramazankara.github.io/pocketstack/studio/) is a static browser page where you paste or upload Compose YAML (and optionally add the project folder so it can inspect mounted assets). It runs entirely in the tab — no backend, no Docker.
:::

## The core loop

Working with PocketStack is three steps:

1. **Analyze** — run `pocketstack analyze` on your Compose file to get a browser-readiness report: which services map to a browser adapter, which don't, and what to do about the gaps.
2. **Generate** — run `pocketstack demo` to write a static demo folder when the stack is browser-native.
3. **Serve** — host the output directory on any static host. See [hosting](/deploy/hosting).

## Worked example: a static site

Start with a minimal nginx static site. Create `compose.yaml`:

```yaml
services:
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro
    ports:
      - "8080:80"
```

Put an `index.html` (and any assets) in a `./site` directory next to the Compose file.

### 1. Analyze

```sh
pocketstack analyze -f compose.yaml
```

```text
Mode: browser-native
Browser readiness: 100% (all services browser-native)
  web: static-web adapter from ./site
```

The `static-web` adapter is autodetected here from the `nginx` image plus the document-root mount — you don't add a label for it. (The other five adapters are opt-in via `pocketstack.adapter`; see [adapters](/adapters/).)

### 2. Generate the demo

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

```text
Generated browser-native demo at /path/to/pocketstack-demo
```

### 3. Open or serve it

The output is plain static files. Open `pocketstack-demo/index.html` directly to preview, or serve the folder:

```sh
npx serve pocketstack-demo
```

::: tip
A static-web demo previews fine from `file://`, but some adapters use a service worker and need `http(s)`. Serving the folder always works. See [troubleshooting](/guide/troubleshooting) if a demo looks empty when opened directly.
:::

## Where to next

- [adapters](/adapters/) — what each adapter can demo, and how assets are mapped.
- [convert a service](/convert/) — what to do when `analyze` reports a service as unsupported.
- [CLI reference](/guide/cli) — every command, flag, and the `--json` output shape.
- [hosting](/deploy/hosting) — static hosts, and when a demo needs cross-origin isolation headers.
