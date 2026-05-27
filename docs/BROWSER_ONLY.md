# Browser-Only Contract

PocketStack demos must be static browser artifacts. That is the product
boundary, the trust boundary, and the compatibility boundary.

That means:

- no hidden backend;
- no remote runner;
- no local Docker daemon at demo time;
- no claim that arbitrary Linux containers run inside the browser.

The CLI may inspect and package a local Compose project. The generated demo
must run as browser code plus static assets.

PocketStack can analyze any Compose file, but it only generates demos for
browser-native stacks. Analysis should stay useful for unsupported projects by
explaining blockers and suggesting browser-native replacements.

## Why This Exists

A good demo is easy to open and easy to trust. If PocketStack says a project is
browser-native, the viewer should be able to put the generated folder on a
static host and know there is no hidden PocketStack service doing work off to
the side.

That also means PocketStack must be honest about what it cannot do. Docker
Compose can describe arbitrary Linux processes, networking, filesystems, and
privileged behavior. Browsers cannot provide all of that. PocketStack supports
the subset that can be mapped to explicit browser adapters.

## Compatibility Rule

A Compose service is supported only when PocketStack can map it to an explicit
browser adapter such as static files, WebAssembly, WebContainer-style frontend
execution, browser databases, or generated mocks.

Unsupported Compose features should produce clear analysis output. They can
become supported later only by adding an honest browser adapter, not by hiding
server work behind a static demo.

## What Counts As Honest

An adapter is honest when it names the browser primitive it uses and preserves
the important behavior of the demo:

- `static-web` copies files and previews them as static assets.
- `frontend` runs a package-managed frontend in a browser runtime.
- `wasi` runs a prebuilt WebAssembly module.
- `mock-http` serves known HTTP responses from OpenAPI and fixtures.
- `postgres-pglite` and `sqlite` run browser database engines.

An adapter is not honest if it silently calls a private backend, pretends to
provide full container semantics, or hides unsupported Docker behavior behind a
successful-looking preview.
