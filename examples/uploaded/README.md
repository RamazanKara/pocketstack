# Upload-Ready Example Projects

These examples are small Compose projects designed for PocketStack Studio and
for public website demos. Each one can be pasted/uploaded into Studio with its
project folder, or compiled with the CLI.

```sh
pocketstack demo -f examples/uploaded/static-blog/compose.yaml -o dist/uploaded-static-blog
pocketstack demo -f examples/uploaded/mock-catalog/compose.yaml -o dist/uploaded-mock-catalog
pocketstack demo -f examples/uploaded/sqlite-notes/compose.yaml -o dist/uploaded-sqlite-notes
```

They intentionally cover different browser adapters:

- `static-blog`: static-web from an nginx document-root mount.
- `mock-catalog`: mock-http from OpenAPI plus JSON fixtures.
- `sqlite-notes`: SQLite from SQL init/seed files.
