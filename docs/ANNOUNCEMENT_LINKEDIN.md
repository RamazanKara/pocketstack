# LinkedIn Announcement

## Primary Post

I just shipped PocketStack v1.0.2.

PocketStack is an open-source tool that turns supported Docker Compose projects
into shareable live demos that run as static browser apps.

The magic trick is not "Docker in the browser."

The real promise is more honest:

If every Compose service can map to a browser-native adapter, PocketStack
packages the project into a static demo. If a service needs real Docker,
privileged Linux behavior, opaque volumes, or container networking, PocketStack
says it is unsupported instead of hiding a backend behind the page.

Current browser adapters:

- static sites from nginx/httpd/caddy document-root mounts
- Node/Bun frontend demos
- prebuilt WASI modules
- OpenAPI + JSON fixture HTTP mocks
- PGlite Postgres demos
- SQLite demos

The release includes:

- a hosted Studio where you can paste or upload Compose YAML
- generated live demos
- upload-ready example projects
- website integration docs for links and iframe embeds
- Chrome, Edge, and Safari-class WebKit smoke tests in CI
- binaries for Linux, macOS, and Windows

Try it here:
https://ramazankara.github.io/pocketstack/

GitHub:
https://github.com/RamazanKara/pocketstack

Release:
https://github.com/RamazanKara/pocketstack/releases/tag/v1.0.2

I built this because sharing a local dev stack should be as easy as sharing a
link when the stack is compatible with browser primitives. PocketStack is still
early, but the boundary is clear: static browser-native demos first, no hidden
server fallback.

Feedback, weird Compose files, and adapter ideas are very welcome.

#opensource #docker #webdevelopment #developerTools #webassembly

## Shorter Variant

I shipped PocketStack v1.0.2.

It turns supported Docker Compose projects into shareable live demos that run
as static browser apps.

Important boundary: this is not "Docker in the browser." PocketStack only
generates a browser-native demo when every service can map to an honest browser
adapter. Otherwise, it reports why the stack is unsupported.

Supported today:

- static web
- Node/Bun frontend demos
- WASI modules
- OpenAPI + fixture mocks
- PGlite Postgres
- SQLite

Try the hosted Studio:
https://ramazankara.github.io/pocketstack/

GitHub:
https://github.com/RamazanKara/pocketstack

#opensource #docker #developerTools #webassembly

## Posting Checklist

- Attach `docs/media/pocketstack-announcement.mp4`.
- Use `docs/media/pocketstack-announcement-poster.png` as the thumbnail if
  LinkedIn asks for one.
- Put the public Studio link in the post body:
  `https://ramazankara.github.io/pocketstack/`.
- Mention the browser-only boundary clearly.
- Avoid claiming full Docker Compose compatibility inside the browser.
