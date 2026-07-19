# Storefront showcase

This example proves a familiar React storefront can become a static PocketStack
preview from two Compose services:

| Service | Browser adapter | What the preview uses |
| --- | --- | --- |
| `web` | `frontend` | Vite runs in a browser WebContainer. |
| `api` | `mock-http` | The OpenAPI route and JSON fixture become a service-worker catalog API. |

The search, category filter, cart quantities, removal, and checkout confirmation
are real local interactions. Checkout is intentionally simulated: there is no
payment processor, order backend, container image, or persistent server in the
preview. The `frontend` adapter requires COOP/COEP headers and network access for
browser-time package installation.

Analyze it with:

```sh
pocketstack analyze -f examples/showcase/storefront/compose.yaml
```
