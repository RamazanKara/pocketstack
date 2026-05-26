# Browser-Only Contract

PocketStack demos must be static browser artifacts.

That means:

- no hidden backend;
- no remote runner;
- no local Docker daemon at demo time;
- no claim that arbitrary Linux containers run inside the browser.

The CLI may inspect and package a local Compose project. The generated demo
must run as browser code plus static assets.

## Compatibility Rule

A Compose service is supported only when PocketStack can map it to an explicit
browser adapter such as static files, WebAssembly, WebContainer-style frontend
execution, browser databases, or generated mocks.

Unsupported Compose features should produce clear analysis output. They can
become supported later only by adding an honest browser adapter, not by hiding
server work behind a static demo.
