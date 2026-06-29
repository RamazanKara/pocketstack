# WASI

The `wasi` adapter runs **prebuilt** `.wasm` modules in the browser. PocketStack
does not compile source, run Docker builds, or manufacture a WASI module from a
container image — point it at an already-built module.

## How it's selected

Set `pocketstack.adapter=wasi` and provide the module (and optional argv) through
the `pocketstack.wasi.*` labels.

```yaml
services:
  tool:
    image: scratch
    labels:
      pocketstack.adapter: wasi
      pocketstack.wasi.module: hello.wasm
      pocketstack.wasi.args: "--name PocketStack"
```

See the [labels reference](/adapters/labels) for accepted values.

## What it runs

The generated demo first tries built-in browser WASI preview1 imports for common
preview1 modules. If the module needs fuller WASI/WASIX behavior, it falls back
to **Wasmer JS** with the same argv and Compose environment values.

argv (from `pocketstack.wasi.args`) and environment values are passed through to
the module.

::: warning
Prebuilt modules only. There is **no** source compilation or build step. If a
project can compile cleanly to WASI, do that in your build pipeline and point
PocketStack at the result.
:::

## Cross-origin isolation

The Wasmer JS fallback requires cross-origin isolation (COOP/COEP) headers and
public CDN access. It still does not use a PocketStack backend. See
[hosting & headers](/deploy/hosting) for how to serve the required headers.
