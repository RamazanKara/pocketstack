---
layout: home

hero:
  name: PocketStack
  text: Browser-native demos from Docker Compose
  tagline: Turn browser-compatible Compose projects into static demos that run entirely in a browser tab — no server, no runner, no Docker at demo time.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Compatibility matrix
      link: /adapters/
    - theme: alt
      text: Try Studio
      link: https://ramazankara.github.io/pocketstack/studio/

features:
  - title: Honest by design
    details: When a service can become browser-native, PocketStack packages it. When it can't, you get a readiness report and concrete conversion steps — never a hidden runner pretending it works.
  - title: Six browser adapters
    details: static-web, frontend (WebContainer), mock-http (OpenAPI), sqlite, postgres-pglite, and wasi — each maps a Compose service to a real browser primitive.
  - title: Static output, hosted anywhere
    details: Generated demos are plain static files. Serve them from any static host; PocketStack emits the COOP/COEP host config when an adapter needs it.
---
