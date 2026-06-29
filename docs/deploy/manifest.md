# Manifest Reference

Every generated demo includes a `pocketstack.manifest.json` at its root. It
describes the demo in a stable, machine-readable form: the generation mode,
host requirements, readiness, and one entry per service with its adapter,
copied assets, and config.

A custom website or the browser runtime reads the manifest to render the
dashboard, warn about [host requirements](/deploy/hosting), and locate copied
assets. The manifest is **version `2`** and always sets `browserOnly: true`.

## Top-level fields

| Field | Type | Notes |
| --- | --- | --- |
| `version` | string | Manifest schema version. Currently `"2"`. |
| `generatedAt` | string | RFC 3339 UTC timestamp of generation. |
| `mode` | string | Generation mode reported by the analyzer. |
| `browserOnly` | boolean | Always `true`. No backend is involved at demo time. |
| `composeFile` | string | Path to the Compose file the demo was generated from. |
| `storageNamespace` | string | Stable per-project namespace (e.g. `ps-1a2b3c4d…`) used by browser-database adapters for IndexedDB/storage keys. |
| `readiness` | object | Browser-readiness summary (see [readiness](#readiness)). |
| `hostRequirements` | object | Cross-origin isolation / network needs (see [host requirements](#host-requirements)). Omitted when empty. |
| `warnings` | string[] | Project-level warnings (COOP/COEP, network access, skipped profile services). Omitted when empty. |
| `nextSteps` | string[] | Project-level conversion next steps. Omitted when empty. |
| `services` | object[] | One [service entry](#service-fields) per generated service. |

### readiness

`readiness` mirrors the analyzer's readiness report:

| Field | Type | Notes |
| --- | --- | --- |
| `status` | string | `ready`, `partial`, or `blocked`. |
| `browserNativeServices` | number | Count of browser-native services. |
| `totalServices` | number | Count of services considered. |
| `score` | number | Percentage of services that are browser-native. |
| `summary` | string | Human-readable readiness summary. |

::: info
A demo only generates when every service is browser-native, so a successful
manifest reports a `ready` readiness. The same readiness fields appear in
`pocketstack analyze` output before generation. See the
[readiness report](/adapters/#readiness-report).
:::

### host requirements

`hostRequirements` appears at both the top level (for the whole demo) and on
each service. The header **values** live in [hosting & headers](/deploy/hosting).

| Field | Type | Notes |
| --- | --- | --- |
| `crossOriginIsolationRequired` | boolean | `true` when a COOP/COEP-isolated context is required. Omitted when false. |
| `networkAccessRequired` | boolean | `true` when the viewer's browser needs CDN/network access at demo time. Omitted when false. |
| `headers` | object | Header name/value pairs the host must apply, when present. Omitted when empty. |

## Service fields

Each entry in `services[]` is a `ManifestService`:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Service name from Compose. |
| `image` | string | Original image reference. Omitted when empty. |
| `adapter` | string | Selected adapter: `static-web`, `frontend`, `mock-http`, `postgres-pglite`, `sqlite`, or `wasi`. See the [adapter matrix](/adapters/). |
| `browserNative` | boolean | `true` for every service in a generated demo. |
| `publicPort` | number | The service's public port, when one applies. Omitted when zero. |
| `browserPath` | string | Path to the service's entry document (e.g. a static site's `index.html`), when it has one. Omitted otherwise. |
| `assets` | object[] | Copied [asset entries](#asset-fields). Omitted when empty. |
| `config` | object | String key/value adapter config (e.g. `projectPath`, `openapiPath`, `fixturesPath`, `initScripts`, `seedPath`, `storageNamespace`). Omitted when empty. |
| `warnings` | string[] | Service-level warnings. Omitted when empty. |
| `hostRequirements` | object | Per-service [host requirements](#host-requirements). Omitted when empty. |

::: tip
`config` keys depend on the adapter. Database adapters
(`postgres-pglite`, `sqlite`) also receive the demo-wide `storageNamespace` in
their `config`. Treat `config` as an open string map keyed by adapter.
:::

### asset fields

Each entry in a service's `assets[]` is a `ManifestAsset` describing files
copied under `assets/<service>/`:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Logical asset name (e.g. `static`, `project`, `module`, `openapi`, `fixtures`, `init`, `seed`). |
| `kind` | string | How it was copied: `file`, `directory`, `sql-directory`, or `json-directory`. |
| `path` | string | Root-relative path to the copied asset, e.g. `assets/<service>/<target>`. |
| `files` | string[] | For directory kinds, the list of copied files (relative paths). Omitted for single files. |
| `target` | string | Destination path relative to the service asset folder. Omitted when empty. |

## Example

A trimmed, realistic manifest for a two-service demo (a `mock-http` API and a
`postgres-pglite` database):

```json
{
  "version": "2",
  "generatedAt": "2026-06-28T10:15:00Z",
  "mode": "browser-only",
  "browserOnly": true,
  "composeFile": "compose.yaml",
  "storageNamespace": "ps-1a2b3c4d5e6f7081",
  "readiness": {
    "status": "ready",
    "browserNativeServices": 2,
    "totalServices": 2,
    "score": 100,
    "summary": "All services are browser-native."
  },
  "services": [
    {
      "name": "api",
      "image": "scratch",
      "adapter": "mock-http",
      "browserNative": true,
      "publicPort": 8080,
      "assets": [
        {
          "name": "openapi",
          "kind": "file",
          "path": "assets/api/openapi.yaml",
          "target": "openapi.yaml"
        },
        {
          "name": "fixtures",
          "kind": "json-directory",
          "path": "assets/api/fixtures",
          "files": ["users.json", "orders.json"],
          "target": "fixtures"
        }
      ],
      "config": {
        "openapiPath": "assets/api/openapi.yaml",
        "fixturesPath": "assets/api/fixtures"
      }
    },
    {
      "name": "db",
      "image": "postgres:16",
      "adapter": "postgres-pglite",
      "browserNative": true,
      "assets": [
        {
          "name": "init",
          "kind": "sql-directory",
          "path": "assets/db/init",
          "files": ["001-schema.sql", "002-seed.sql"],
          "target": "init"
        }
      ],
      "config": {
        "initPath": "assets/db/init",
        "storageNamespace": "ps-1a2b3c4d5e6f7081"
      }
    }
  ]
}
```

::: info
When a service requires cross-origin isolation, the same generation run also
emits `_headers`, `vercel.json`, and `staticwebapp.config.json` next to the
manifest. See [hosting & headers](/deploy/hosting).
:::
