# Contributing

PocketStack accepts changes that preserve the browser-only contract:

- no hidden backend
- no remote runner fallback
- no Docker daemon requirement at demo time
- no claims that arbitrary Linux containers run in the browser

Good contributions make the supported surface clearer. If a Compose feature
cannot be represented by a browser adapter, prefer a precise unsupported reason
over a partial demo that looks more compatible than it is.

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

New adapters should add:

- analyzer classification tests;
- generated manifest coverage;
- browser runtime tests;
- an example Compose project;
- documentation in the compatibility matrix;
- clear unsupported-feature reporting for nearby cases that still cannot work.
