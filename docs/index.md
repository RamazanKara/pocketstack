---
layout: home

hero:
  name: PocketStack
  text: A preview for every Compose PR
  tagline: Add one GitHub Action. Browser-compatible Docker Compose pull requests receive a static, shareable preview; unsupported services receive a precise blocking report.
  actions:
    - theme: brand
      text: Add the GitHub Action
      link: /guide/pr-previews
    - theme: alt
      text: Check compatibility
      link: /adapters/
    - theme: alt
      text: See the examples
      link: https://ramazankara.github.io/pocketstack/#examples

features:
  - title: One pull-request workflow
    details: The Action checks out the PR, analyzes Compose, generates static output, deploys a stable branch URL, and updates one PR comment.
  - title: Compatibility stays explicit
    details: Arbitrary containers never masquerade as previews. Partial and blocked stacks fail the check and receive a static report with service-level reasons and suggestions.
  - title: Proven with real applications
    details: A storefront, sprint board, and analytics dashboard demonstrate frontend, mock HTTP, PGlite, and static-web adapters through working interactions.
---

## The contract

PocketStack publishes an **application preview only when every active Compose
service maps to a browser adapter**. There is no Docker runner behind the URL.

| Readiness | Action result | Published content |
| --- | --- | --- |
| Ready | Pass | Static application preview |
| Partial | Fail | Static compatibility report only |
| Blocked | Fail | Static compatibility report only |
| Error | Fail | Static error report when deployment is configured |

[Set up PR previews →](/guide/pr-previews)
