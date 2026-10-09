# CLI Reference

PocketStack has three commands: `analyze`, `demo`, and `version`. The CLI inspects and packages a local Compose project; it never starts a server or contacts a backend.

```text
pocketstack analyze [-f compose.yaml] [--json | --format text|json|markdown] [--profile name] [--safe-root directory]
pocketstack demo [-f compose.yaml] [-o pocketstack-demo] [--profile name] [--safe-root directory]
pocketstack version
```

## Commands

### `analyze`

Reads a Compose file and reports browser readiness without writing anything.

```sh
pocketstack analyze -f compose.yaml
```

Flags:

| Flag | Default | Description |
| --- | --- | --- |
| `-f` | (resolved) | Path to the Compose file. If omitted, PocketStack searches the working directory (see [Compose-file resolution](#compose-file-resolution)). |
| `--json` | `false` | Print the full analysis as JSON instead of the human-readable report. |
| `--format` | `text` | Select `text`, `json`, or `markdown`. `--json` can only be combined with an explicit `--format json`. |
| `--profile` | (none) | Enable a Compose profile; repeat for multiple profiles, or pass `"*"` for all. |
| `--safe-root` | (unrestricted) | Confine Compose, bind mounts, env files, and labeled assets to this directory; reject paths or symlinks outside it. |

### `demo`

Generates a static, browser-native demo from a Compose file. This only succeeds when every active service maps to a browser adapter; otherwise it exits with an error and you should run `analyze` with the same profiles to see why.

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Flags:

| Flag | Default | Description |
| --- | --- | --- |
| `-f` | (resolved) | Path to the Compose file (same resolution as `analyze`). |
| `-o` | `pocketstack-demo` | Output directory for the generated demo. |
| `--profile` | (none) | Enable profiles using the same selection as `analyze`. |
| `--safe-root` | (unrestricted) | Apply the same project-path restrictions as `analyze`. |

Output may be inside a source directory; it is excluded from copied assets.
The output directory must not contain source assets, to avoid overwriting them.
Projects with no active services cannot generate a demo.

On success it prints the mode and the absolute output path:

```text
Generated browser-native demo at /path/to/pocketstack-demo
```

Serve that directory from any static host. See [hosting](/deploy/hosting).

### `version`

Prints the CLI version.

```sh
pocketstack version
```

Use `pocketstack --help`, `pocketstack analyze --help`, or
`pocketstack demo --help` for usage. Help exits successfully.

## `analyze` output structure

The human-readable report is printed in this order:

- `Mode:` — `browser-native` or `unsupported`.
- `Browser readiness: N% (summary)` — the readiness score and a one-line summary.
- **Per-service lines.** A browser-native service prints its adapter and, when known, its asset source:

  ```text
    web: static-web adapter from /path/to/site
  ```

  An unsupported service prints its blockers and suggestions:

  ```text
    cache: unsupported in browser-native mode
      - image "redis:7" is a stateful service without a direct browser-native container adapter
      suggestion: For demos, replace this stateful service with SQLite, PGlite, fixtures, or in-browser mock state.
  ```

  Browser-native services may also print `- warning:` lines for behavior that can't be reproduced exactly.
- `Warnings:` — a project-level section, shown only when there are warnings.
- `Next steps:` — shown only when the project is **not** fully browser-native.

## `--json` output shape

`analyze --json` prints the full analysis object. At a high level:

```jsonc
{
  "mode": "browser-native",
  "browserNative": true,
  "readiness": {
    "status": "ready",          // "ready" | "partial" | "blocked"
    "score": 100,                // percentage of services that are browser-native
    "browserNativeServices": 1,
    "totalServices": 1,
    "summary": "all services are browser-native"
  },
  "services": [
    {
      "name": "web",
      "browserNative": true,
      "adapter": "static-web",
      "assetSource": "/path/to/site",
      "hostRequirements": {}     // empty optional slices are omitted
    }
  ],
  "nextSteps": ["Run `pocketstack demo` to generate a static browser-native demo."],
  "hostRequirements": {}         // e.g. cross-origin isolation, when a demo needs it
}
```

::: tip
Use `--json` in CI to gate on `readiness.status` or `readiness.score` rather than parsing the text report.
:::

## Markdown reports

Save a report for an issue, pull request, or build artifact:

```sh
pocketstack analyze -f examples/static-site/compose.yaml --format markdown > compatibility.md
```

The report includes readiness, each active service's adapter or blockers,
asset sources, suggestions, service and project warnings, and next steps.
Project text is escaped so names, paths, and messages cannot inject Markdown
structure or HTML. Environment values and packaged configuration are omitted;
use JSON when you need the complete analysis object.

Markdown uses the same exit codes as text and JSON. An incompatible stack still
returns `0` from `analyze`; inspect JSON readiness when gating deployment.

## Selecting profiles

Services without profiles are always active. With no `--profile` flags, services
that declare profiles are skipped, as before. A service with several profiles
is included when any one matches. For example:

```yaml
services:
  db:
    image: postgres:16
    profiles: [preview, database]
  cache:
    image: redis:7
    profiles: [debug]
```

```sh
pocketstack analyze -f compose.yaml --profile preview
pocketstack demo -f compose.yaml --profile preview -o pocketstack-demo
pocketstack analyze -f compose.yaml --profile preview --profile debug
pocketstack analyze -f compose.yaml --profile "*" --format markdown
```

The first two commands select `db`. The last two also select the incompatible
Redis service, so readiness becomes partial and generation would be blocked.
Only selected services appear in the generated manifest and packaged assets.
Unknown profile names activate no additional services; duplicates have no
effect. Empty profile arguments are usage errors. PocketStack reads explicit
flags, not `COMPOSE_PROFILES` from the host environment. Dependencies and health
checks retain their existing behavior; see [Compose features](/adapters/#compose-features).

## Configuration diagnostics

Both commands report the Compose filename and line for YAML decoding errors
and invalid modeled values. For example, `environment: DEBUG=true` produces:

```text
compose.yaml: service "app": line 3: environment must be a mapping or a list of KEY=value strings
```

Use `environment: {DEBUG: "true"}` or `environment: [DEBUG=true]` instead.
Environment and label entries must be scalar values; env-file paths must be
non-empty strings, and long env-file entries need a `path` and a valid
`required` boolean. Existing quoted booleans remain accepted. Invalid service
names, duplicate keys, and malformed typed fields also carry line context.

YAML anchors, merge keys, extension fields, scalar/null environment values,
optional env files, and port ranges remain supported. This validates the
subset PocketStack reads, not the entire Compose specification. Unknown
directives still need review against the [adapter limits](/adapters/).

## Compose-file resolution

When `-f` is omitted, PocketStack looks for these files in the working directory, in order, and uses the first that exists:

1. `compose.yaml`
2. `compose.yml`
3. `docker-compose.yml`
4. `docker-compose.yaml`

If none is found, it exits with an error asking you to pass `-f`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success or help. `analyze` also returns 0 for valid but incompatible projects; inspect readiness to gate deployment. |
| `1` | Error — bad or missing Compose file, or generation failed. |
| `2` | Usage error — unknown command or bad flags. |
