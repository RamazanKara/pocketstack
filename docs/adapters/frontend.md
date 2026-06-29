# Frontend

The `frontend` adapter packages Node/Bun projects that can run from source in a
browser runtime, so the demo serves your actual app rather than a prebuilt copy.

## How it's selected

A frontend service is **autodetected** when it uses a Node/Bun image and has a
`package.json`. Use `pocketstack.adapter=frontend` when the image alone is not
enough to infer intent.

```yaml
services:
  app:
    image: node:22-alpine
    working_dir: /app
    command: npm run dev -- --host 0.0.0.0
    volumes:
      - ./app:/app
    ports:
      - "5173:5173"
    labels:
      pocketstack.adapter: frontend
      pocketstack.frontend.install: npm install
      pocketstack.frontend.start: npm run dev -- --host 0.0.0.0
      pocketstack.frontend.port: "5173"
```

## What it packages

PocketStack packages the project root or the bind-mounted `working_dir` and
keeps simple `entrypoint`/`command` start behavior.

The `pocketstack.frontend.*` labels make the install command, start command, and
port explicit when they cannot be inferred. See the
[labels reference](/adapters/labels) for accepted values.

## Environment variables

Compose `environment:` and `env_file:` values are passed into the browser
runtime.

- Required env files must be present in the uploaded/generated project.
- Optional long-syntax env files may be missing and are reported as warnings.

## Talking to mock and database services

When frontend code points at a `mock-http` service with a Compose-style URL such
as `http://api:8080`, the generated runtime rewrites it to the static demo's
browser mock URL. PocketStack also injects service URL environment variables such
as `POCKETSTACK_API_URL` and `VITE_POCKETSTACK_API_URL`.

If a frontend needs PocketStack mock or database endpoints from inside the
preview iframe, the generator mounts a small **bridge script** into the project.
The bridge forwards only known PocketStack demo endpoints — it is not a general
network proxy. For the exact endpoint shapes, see the
[service URLs](/reference/service-urls).

## Cross-origin isolation

The frontend runtime requires cross-origin isolation (COOP/COEP) headers.
PocketStack emits host config files when they are needed. See
[hosting & headers](/deploy/hosting) for how to serve them.
