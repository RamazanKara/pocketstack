# Analytics dashboard showcase

This example proves a polished analytics dashboard can be published from a
recognizable nginx Compose service:

| Service | Browser adapter | What the preview uses |
| --- | --- | --- |
| `web` | `static-web` | PocketStack copies the mounted document root into the static preview. |

The 7/30/90-day selector, chart tooltips, and sortable table are implemented in
plain browser JavaScript. The numbers are a deterministic demo dataset; there
is no live analytics pipeline, nginx process, backend, or production data in the
preview.

```sh
pocketstack analyze -f examples/showcase/analytics/compose.yaml
```
