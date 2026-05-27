# Upload-Ready Example Projects

These examples are small Compose projects designed for PocketStack Studio and
for public website demos. Each one can be pasted/uploaded into Studio with its
project folder, or compiled with the CLI.

They are intentionally small enough to inspect by hand and use as templates.

```sh
pocketstack demo -f examples/uploaded/static-blog/compose.yaml -o dist/uploaded-static-blog
pocketstack demo -f examples/uploaded/mock-catalog/compose.yaml -o dist/uploaded-mock-catalog
pocketstack demo -f examples/uploaded/sqlite-notes/compose.yaml -o dist/uploaded-sqlite-notes
```

| Example | Adapter | What it demonstrates |
| --- | --- | --- |
| `static-blog` | `static-web` | nginx document-root mount copied into a static preview |
| `mock-catalog` | `mock-http` | OpenAPI routes plus JSON fixtures served by the browser |
| `sqlite-notes` | `sqlite` | SQL init/seed files loaded into a resettable browser database |

## Using Them In Studio

Open Studio, upload the example `compose.yaml`, then upload the whole example
folder as the project folder. Studio should classify every service as
browser-native and show any adapter-specific host requirements.
