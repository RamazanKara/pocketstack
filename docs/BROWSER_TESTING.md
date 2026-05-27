# Browser Testing

PocketStack's public site and generated demos have a basic browser smoke suite:

```sh
make pages
npm run test:browsers
```

The suite serves `dist/pages` locally and checks:

- landing page loads;
- Studio loads;
- Studio sample analysis runs in Chromium-based browsers;
- generated static demo dashboard loads;
- generated manifest loads;
- static demo preview loads.

CI installs Playwright browsers and runs the suite against:

- Chrome/Chromium;
- Microsoft Edge;
- Safari-class WebKit.

Locally, the test skips browsers that are not installed unless
`POCKETSTACK_REQUIRE_BROWSERS=1` is set.

## When To Run It

Run the browser suite after changes to:

- `site/`
- `studio/`
- generated demo HTML/CSS/runtime behavior
- `scripts/build-pages-site.mjs`
- GitHub Pages workflow configuration

The suite is intentionally a smoke test. It catches broken public navigation,
missing generated assets, dashboard regressions, and browser-launch issues. It
does not replace adapter unit tests or Playwright coverage for every generated
demo category.

## Reading Failures

An Edge skip on a local machine usually means Microsoft Edge is not installed.
CI treats browser skips as failures because it sets
`POCKETSTACK_REQUIRE_BROWSERS=1`.

If a generated demo fails locally, rebuild the site first:

```sh
make pages
```

That command regenerates all public demo folders before the browser suite reads
from `dist/pages`.
