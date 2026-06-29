# Browser Testing

PocketStack's public site and generated demos have a basic browser smoke suite:

```sh
make pages
npm run test:browsers
```

The suite serves `dist/pages` locally and checks:

- the landing page loads;
- Studio loads;
- Studio sample analysis runs in Chromium-based browsers;
- the generated static demo dashboard loads;
- the generated manifest loads;
- the static demo preview loads.

CI installs Playwright browsers and runs the suite against Chrome/Chromium,
Microsoft Edge, and Safari-class WebKit. Locally, the test skips browsers that
are not installed unless `POCKETSTACK_REQUIRE_BROWSERS=1` is set.

## When to run it

Run the browser suite after changes to:

- `web/site`
- `web/studio`
- generated demo HTML/CSS/runtime behavior
- `scripts/build-pages-site.mjs`
- GitHub Pages workflow configuration

::: info
This is intentionally a **smoke test**. It catches broken public navigation,
missing generated assets, dashboard regressions, and browser-launch issues. It
does not replace adapter unit tests or per-demo Playwright coverage.
:::

## Reading failures

An Edge skip on a local machine usually means Microsoft Edge is not installed.
CI treats browser skips as failures because it sets
`POCKETSTACK_REQUIRE_BROWSERS=1`.

If a generated demo fails locally, rebuild the site first:

```sh
make pages
```

That command regenerates all public demo folders before the browser suite reads
from `dist/pages`.
