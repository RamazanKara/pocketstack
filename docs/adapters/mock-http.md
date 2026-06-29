# Mock HTTP

The `mock-http` adapter turns OpenAPI specs and JSON fixtures into static
browser routes served from the demo's service worker. YAML parsing is bundled
into the generated runtime, so packaged demos do not need a parser CDN just to
read local specs.

## How it's selected

Set `pocketstack.adapter=mock-http` and point at the spec (and optionally a
fixtures directory).

```yaml
services:
  api:
    image: scratch
    labels:
      pocketstack.adapter: mock-http
      pocketstack.mock.openapi: openapi.yaml
      pocketstack.mock.fixtures: fixtures
      pocketstack.mock.port: "8080"
```

See the [labels reference](/adapters/labels) for accepted values.

## Supported features

- OpenAPI YAML or JSON;
- local `#/components/...` and path-item references;
- path templates and required query parameter examples/defaults;
- response status codes, headers, media types, and no-body responses;
- JSON fixture overrides;
- request-aware fixtures using `request.params`, `request.query`,
  `request.json`, `request.text`, or `bodyFrom: "request"`;
- CORS and preflight responses for frontend demos.

## Fixtures

Fixture directories package `.json` files only. Other files are skipped with a
warning.

::: warning
A fixtures-only mock (no OpenAPI spec) must contain at least one JSON fixture.
:::

## Route URL

Mock routes are served under a `/__pocketstack/mock/<service>/<route>` path. See
the [service URLs](/reference/service-urls) for the exact route shape and how
`<service>` and `<route>` are resolved.
