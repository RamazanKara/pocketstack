# Browser-Only Contract

PocketStack demos must be static browser artifacts.

That means:

- no hidden backend
- no remote runner
- no local Docker daemon at demo time
- no claim that arbitrary Linux containers run inside the browser

The CLI can inspect and package a local Compose project, but the generated demo must run as browser code and static assets.

Unsupported Compose features should produce clear analysis output. Over time, those features can become supported only by adding a browser adapter such as WebAssembly, in-browser JavaScript runtimes, IndexedDB-backed storage, or generated mocks.
