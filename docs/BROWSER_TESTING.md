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
