# CLI Reference

PocketStack has three commands: `analyze`, `demo`, and `version`. The CLI inspects and packages a local Compose project; it never starts a server or contacts a backend.

```text
pocketstack analyze [-f compose.yaml] [--json]
pocketstack demo [-f compose.yaml] [-o pocketstack-demo]
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

### `demo`

Generates a static, browser-native demo from a Compose file. This only succeeds when every default service maps to a browser adapter; otherwise it exits with an error and you should run `analyze` to see why.

```sh
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Flags:

| Flag | Default | Description |
| --- | --- | --- |
| `-f` | (resolved) | Path to the Compose file (same resolution as `analyze`). |
| `-o` | `pocketstack-demo` | Output directory for the generated demo. |

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

## `analyze` output structure

The human-readable report is printed in this order:

- `Mode:` — `browser-native` or `unsupported`.
- `Browser readiness: N% (summary)` — the readiness score and a one-line summary.
- **Per-service lines.** A browser-native service prints its adapter and, when known, its asset source:

  ```text
    web: static-web adapter from ./site
  ```

  An unsupported service prints its blockers and suggestions:

  ```text
    cache: unsupported in browser-native mode
      - stateful service has no honest browser adapter
      suggestion: replace with SQLite, PGlite, fixtures, or in-browser mock state
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
    "summary": "all services browser-native"
  },
  "services": [
    {
      "name": "web",
      "browserNative": true,
      "adapter": "static-web",
      "assetSource": "./site",
      "warnings": [],
      "unsupported": [],         // reasons, when not browser-native
      "suggestions": []          // conversion hints, when not browser-native
    }
  ],
  "warnings": [],
  "nextSteps": [],
  "hostRequirements": {}         // e.g. cross-origin isolation, when a demo needs it
}
```

::: tip
Use `--json` in CI to gate on `readiness.status` or `readiness.score` rather than parsing the text report.
:::

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
| `0` | Success. |
| `1` | Error — bad or missing Compose file, or generation failed. |
| `2` | Usage error — unknown command or bad flags. |
