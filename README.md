# PocketStack

PocketStack turns browser-compatible Docker Compose projects into shareable
demos that run as static browser apps — no hidden server, no runner, and no
Docker at demo time.

> Drop in a `compose.yaml`, get a static, browser-native demo when every service
> maps to a browser primitive. When one can't, PocketStack tells you why and how
> to reshape it — it never fakes a runner.

**[Try it now](https://ramazankara.github.io/pocketstack/)** ·
**[Documentation](https://ramazankara.github.io/pocketstack/docs/)** ·
**[Studio](https://ramazankara.github.io/pocketstack/studio/)**

[![PocketStack announcement video](docs/media/pocketstack-announcement-poster.png)](docs/media/pocketstack-announcement.mp4)

## What you can demo

Six browser adapters map Compose services to real browser primitives:
`static-web`, `frontend` (WebContainer), `mock-http` (OpenAPI), `sqlite`,
`postgres-pglite`, and `wasi`. See the [compatibility matrix](docs/adapters/index.md).

PocketStack is not a Docker replacement. Privileged containers, arbitrary
daemons, opaque volumes, and real Linux networking stay unsupported unless a
browser adapter exists — in which case `analyze` reports the gap and how to
[convert it](docs/convert/index.md).

## Install

Download the latest binary from
[GitHub Releases](https://github.com/ramazankara/pocketstack/releases/latest),
or build from source:

```sh
git clone https://github.com/ramazankara/pocketstack.git
cd pocketstack
nvm use
npm ci
npm run build:wasi-example
npm run build:runtime
go build -o bin/pocketstack ./cmd/pocketstack
```

Full instructions and prerequisites: [installation](docs/guide/installation.md).

## Quick start

```sh
# See which services map to a browser adapter
pocketstack analyze -f compose.yaml

# Generate a static, browser-only demo
pocketstack demo -f compose.yaml -o pocketstack-demo
```

Serve `pocketstack-demo/` from any static host. Some demos need COOP/COEP
headers; PocketStack emits the host config when they do. Walk through it in
[getting started](docs/guide/getting-started.md), then see [hosting](docs/deploy/hosting.md).

## Studio

[PocketStack Studio](https://ramazankara.github.io/pocketstack/studio/) is a
static browser page for quick compatibility checks — paste or upload Compose
YAML and read the readiness report, entirely in the tab. Run it locally with
`make studio`.

## Documentation

Full docs are published at **<https://ramazankara.github.io/pocketstack/docs/>**
(source under [`docs/`](docs/)):

- [Getting started](docs/guide/getting-started.md) · [CLI reference](docs/guide/cli.md) · [Concepts & glossary](docs/guide/concepts.md) · [Troubleshooting](docs/guide/troubleshooting.md)
- [Adapters & compatibility](docs/adapters/index.md) · [Labels](docs/adapters/labels.md) · [Conversion guide](docs/convert/index.md)
- [Hosting](docs/deploy/hosting.md) · [Website integration](docs/deploy/website-integration.md) · [Manifest reference](docs/deploy/manifest.md)
- [Architecture](docs/reference/architecture.md) · [Service URLs](docs/reference/service-urls.md) · [Contributing](docs/contribute/index.md)

## Product boundary

PocketStack stays browser-native. It will not add a hidden Docker runner to make
unsupported services appear compatible. When a stack can become browser-native,
PocketStack packages it; when it cannot, it explains the gap. See the
[browser-only contract](docs/guide/concepts.md).

## Commands

```text
pocketstack analyze [-f compose.yaml] [--json]
pocketstack demo [-f compose.yaml] [-o pocketstack-demo]
pocketstack version
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[development guide](docs/contribute/index.md). Report security issues per
[SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).
