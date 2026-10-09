# Getting Started

PocketStack turns a browser-compatible Docker Compose pull request into a
static, shareable preview. The primary workflow is one GitHub Action; the local
CLI uses the same compatibility analyzer and generator.

::: warning Browser-compatible only
PocketStack is not a remote Docker runner. An application preview is published
only when every active service maps to a browser adapter. Partial and blocked
stacks fail the check and publish a static compatibility report instead.
:::

## Recommended: preview every pull request

1. Create a Cloudflare Pages Direct Upload project.
2. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as repository secrets.
3. Add the PocketStack workflow under `.github/workflows/`.
4. Open or update a pull request that changes your browser-compatible Compose project.

PocketStack analyzes the project, generates static output, deploys the stable
`pr-<number>` alias, and creates or updates one pull-request comment.

[Follow the complete PR preview setup →](/guide/pr-previews)

## What compatibility means

Each active service must map to one of six browser adapters: `static-web`,
`frontend`, `mock-http`, `postgres-pglite`, `sqlite`, or `wasi`. For example:

```yaml
services:
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro
```

The nginx document-root mount maps to `static-web`, so the generated preview is
the static site itself. By contrast, a Redis daemon has no browser adapter and
blocks application deployment. The [compatibility matrix](/adapters/) explains
every adapter and the [conversion guide](/convert/) suggests browser-native
substitutions.

## Inspect the same result locally

Install the CLI, then analyze the Compose file:

```sh
pocketstack analyze -f compose.yaml
```

Ready projects report a 100% browser-readiness score. Generate the static output
with:

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Serve the output from any static host:

```sh
npx serve pocketstack-demo
```

Service workers need HTTPS or localhost. Frontend/WebContainer and the WASI
fallback also need COOP/COEP headers; a plain `serve` invocation does not add
them. PocketStack emits host configuration for those adapters; see
[hosting](/deploy/hosting). PGlite and SQLite do not require isolation headers.

## Try a known-compatible project

- [Pocket Supply storefront](https://github.com/ramazankara/pocketstack/tree/main/examples/showcase/storefront) — `frontend` + `mock-http`
- [Northstar sprint board](https://github.com/ramazankara/pocketstack/tree/main/examples/showcase/sprint-board) — `frontend` + `postgres-pglite`
- [Clearview analytics](https://github.com/ramazankara/pocketstack/tree/main/examples/showcase/analytics) — `static-web`

For a quick no-install check, [PocketStack Studio](https://ramazankara.github.io/pocketstack/studio/)
runs the analyzer in the browser. Studio is useful for exploration; the GitHub
Action is the repeatable PR workflow.
