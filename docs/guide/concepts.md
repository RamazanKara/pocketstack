# Concepts

PocketStack is built on one promise: a generated demo is a static browser artifact and nothing else. This page states that contract and defines the terms the docs use.

## The browser-only contract

PocketStack demos must be static browser artifacts. That is the product boundary, the trust boundary, and the compatibility boundary at once. Concretely, a generated demo has:

- **no hidden backend;**
- **no remote runner;**
- **no local Docker daemon at demo time;**
- **no claim that arbitrary Linux containers run inside the browser.**

The CLI may inspect and package a local Compose project, but the generated demo runs as browser code plus static assets. PocketStack can *analyze* any Compose file; it only *generates* demos for browser-native stacks.

The flip side of the contract is honesty about limits: **unsupported stays unsupported.** A feature that has no honest browser adapter is reported with concrete reasons and conversion suggestions — it is never hidden behind a successful-looking preview. Unsupported behavior can become supported later only by adding a real browser adapter, not by smuggling in server work.

## browser-native vs browser-only

The docs use two closely related terms. They are not synonyms:

- **browser-only** is the *boundary and the promise*: nothing runs outside the tab. No backend, no runner, no Docker at demo time. It describes what PocketStack will and won't do.
- **browser-native** is what a generated demo *is*: built from real browser primitives — static files, WebAssembly, a browser runtime, browser databases, service-worker mocks. It describes how the demo is constructed.

Put together: PocketStack only generates **browser-native** demos because the **browser-only** contract forbids anything else. `analyze` reports `Mode: browser-native` when every service maps to a browser primitive, and `unsupported` when one or more cannot.

## Glossary

**Adapter**
: The mapping from a Compose service to a specific browser primitive. PocketStack has six: `static-web`, `frontend`, `mock-http`, `postgres-pglite`, `sqlite`, and `wasi`. `static-web` is autodetected; the others are selected with a `pocketstack.adapter` label. See [adapters](/adapters/).

**Readiness score**
: The percentage of services in a stack that are browser-native, reported by `analyze` as `Browser readiness: N%`. It comes with a `status` of `ready`, `partial`, or `blocked`, plus per-service blockers and project-level next steps. The point is to make unsupported services *actionable*, not just to grade the project.

**Honest adapter**
: An adapter that names the browser primitive it uses and preserves the demo's important behavior — for example, `static-web` copies and serves files, `wasi` runs a prebuilt WebAssembly module. An adapter is *not* honest if it silently calls a private backend, pretends to provide full container semantics, or hides unsupported Docker behavior behind a preview that looks like it worked.

**Demo**
: The static output folder produced by `pocketstack demo`. It contains the entry page, manifest, runtime, any service-worker mock, and packaged assets, all using relative paths so it can be hosted under a subpath. See [hosting](/deploy/hosting).

**Manifest**
: The `pocketstack.manifest.json` file written into a demo. It describes the demo's services and adapters for the browser runtime. Keep it alongside the rest of the generated files when you deploy.

**Studio**
: The static browser page for quick compatibility checks. Paste or upload Compose YAML, optionally add the project folder, and Studio reports readiness — entirely in the tab, with no PocketStack backend, Docker daemon, or runner. Hosted at [Studio](https://ramazankara.github.io/pocketstack/studio/).

## Related

- [adapters](/adapters/) — what each adapter supports and how assets are mapped.
- [convert a service](/convert/) — turning an unsupported service into a browser-native shape.
