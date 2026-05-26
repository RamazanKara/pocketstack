# Contributing

PocketStack accepts changes that preserve the browser-only contract:

- no hidden backend
- no remote runner fallback
- no Docker daemon requirement at demo time
- no claims that arbitrary Linux containers run in the browser

Before opening a change:

```sh
npm ci
npm run build:wasi-example
npm run build:runtime
npm run test:runtime
go test ./...
go vet ./...
make smoke
```

New adapters should add analyzer tests, generated manifest coverage, example Compose projects, and documentation.
