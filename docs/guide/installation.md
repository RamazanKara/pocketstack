# Installation

PocketStack ships as a single binary. Download a prebuilt release, or build from source if you want the latest `main` or an unsupported platform.

## Prebuilt binary

Download the latest binary from [GitHub Releases](https://github.com/ramazankara/pocketstack/releases/latest). Builds are published for:

- **Linux** — `amd64`, `arm64`
- **macOS** — `amd64`, `arm64`
- **Windows** — `amd64`, `arm64`

Put the binary on your `PATH` (for example `/usr/local/bin` on Linux/macOS), then verify:

```sh
pocketstack version
```

::: tip macOS Gatekeeper
On macOS you may need to clear the quarantine attribute the first time:

```sh
xattr -d com.apple.quarantine ./pocketstack
```
:::

## Build from source

### Prerequisites

- **Go** — to compile the CLI.
- **Node 26** — the JavaScript toolchain targets the current Node line, Node 26. The repo includes an `.nvmrc`, so `nvm use` selects the right version.

### Steps

```sh
git clone https://github.com/ramazankara/pocketstack.git
cd pocketstack
nvm use
npm ci
npm run build:wasi-example
npm run build:runtime
go build -o bin/pocketstack ./cmd/pocketstack
```

The `npm run build:*` steps compile the browser runtime and the bundled WASI example that the generated demos embed; run them before `go build` so the binary packages the current runtime assets.

### Verify

```sh
bin/pocketstack version
```

Move `bin/pocketstack` onto your `PATH` to use it as `pocketstack` from anywhere.

## Next steps

- [Getting started](/guide/getting-started) — the analyze → demo → serve loop, with a worked example.
- [CLI reference](/guide/cli) — every command and flag.
