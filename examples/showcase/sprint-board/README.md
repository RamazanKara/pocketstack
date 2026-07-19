# Sprint board showcase

This example proves a familiar issue board can become a static PocketStack
preview from a React frontend and a Postgres-shaped Compose service:

| Service | Browser adapter | What the preview uses |
| --- | --- | --- |
| `app` | `frontend` | Vite runs in a browser WebContainer. |
| `db` | `postgres-pglite` | PGlite applies `db/init.sql` and persists changes in IndexedDB. |

Create an issue, drag cards between columns, or focus a card and press the left
or right arrow key. Changes are written to the browser database. This preview
does not run the Postgres image, extensions, server networking, or production
database behavior; PGlite is the explicit browser adapter. The frontend also
requires COOP/COEP headers and browser-time network access.

```sh
pocketstack analyze -f examples/showcase/sprint-board/compose.yaml
```
