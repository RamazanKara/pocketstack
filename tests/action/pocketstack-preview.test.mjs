import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WRANGLER_VERSION,
  escapeHTML,
  main,
  normalizeAnalysis,
  parseDeploymentURL,
  renderCompatibilityHTML,
  renderMarkdown,
} from "../../scripts/action/pocketstack-preview.mjs";

function analysis(status = "ready") {
  const services = status === "ready"
    ? [
      { name: "web", image: "node:22", adapter: "frontend", browserNative: true, assets: [] },
      { name: "api", image: "scratch", adapter: "mock-http", browserNative: true, assets: [] },
    ]
    : status === "partial"
      ? [
        { name: "web", image: "node:22", adapter: "frontend", browserNative: true, assets: [] },
        {
          name: "cache<script>",
          image: "redis:7",
          adapter: "unsupported",
          browserNative: false,
          unsupported: ["requires <container> semantics"],
          suggestions: ["Replace with browser state"],
          assets: [],
        },
      ]
      : [{ name: "cache", image: "redis:7", adapter: "unsupported", browserNative: false, unsupported: ["no adapter"], assets: [] }];
  const ready = services.filter((service) => service.browserNative).length;
  const score = Math.floor((ready * 100) / services.length);
  return {
    composeFile: "compose.yaml",
    projectRoot: ".",
    mode: status === "ready" ? "browser-native" : "unsupported",
    browserNative: status === "ready",
    readiness: {
      status,
      score,
      browserNativeServices: ready,
      totalServices: services.length,
      summary: `${ready} of ${services.length} services are browser-native`,
    },
    services,
    warnings: [],
    nextSteps: [],
  };
}

test("normalizes ready, partial, and blocked compatibility reports", () => {
  for (const status of ["ready", "partial", "blocked"]) {
    const result = normalizeAnalysis(analysis(status));
    assert.equal(result.readiness.status, status);
    assert.ok(result.readiness.score >= 0 && result.readiness.score <= 100);
  }
  assert.throws(() => normalizeAnalysis({ readiness: { status: "maybe", score: 100 } }), /invalid readiness status/);
});

test("caps large reports and escapes untrusted Markdown and HTML", () => {
  const value = analysis("blocked");
  value.services = Array.from({ length: 140 }, (_, index) => ({
    name: `service-${index}<script>`,
    image: "redis:7|bad",
    adapter: "unsupported",
    browserNative: false,
    unsupported: ["<img src=x onerror=alert(1)>", ...Array.from({ length: 20 }, () => "reason")],
  }));
  value.readiness.totalServices = value.services.length;
  const normalized = normalizeAnalysis(value);
  assert.equal(normalized.services.length, 100);
  assert.equal(normalized.omittedServices, 40);
  assert.equal(normalized.services[0].unsupported.length, 10);
  const html = renderCompatibilityHTML({ prNumber: 7, composeInput: "compose.yaml" }, normalized);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  const markdown = renderMarkdown({}, { kind: "blocked", score: 0, analysis: normalized });
  assert.doesNotMatch(markdown, /<img src/);
  assert.match(markdown, /&lt;img src/);
  assert.equal(escapeHTML(`<&"'>`), "&lt;&amp;&quot;&#39;&gt;");
});

test("parses the immutable Cloudflare deployment URL", () => {
  const stable = "https://pr-42.demo.pages.dev";
  assert.equal(
    parseDeploymentURL(`Alias ${stable}\nDeployment https://9f3a.demo.pages.dev`, stable),
    "https://9f3a.demo.pages.dev",
  );
  assert.equal(WRANGLER_VERSION, "4.112.0");
});

test("main replaces the stable alias across ready, blocked, ready, and closed states", async () => {
  const fixture = await actionFixture();

  let code = await main(await fixture.environment({ status: "ready" }));
  assert.equal(code, 0);
  assert.match(await readFile(fixture.capture, "utf8"), /generated app/);
  assert.match(await readFile(fixture.output, "utf8"), /preview_url=https:\/\/pr-42\.demo-previews\.pages\.dev/);

  code = await main(await fixture.environment({ status: "blocked" }));
  assert.equal(code, 1);
  assert.match(await readFile(fixture.capture, "utf8"), /No app preview published/);
  assert.doesNotMatch(await readFile(fixture.output, "utf8"), /preview_url=https:\/\/pr-42/);

  code = await main(await fixture.environment({ status: "ready" }));
  assert.equal(code, 0);
  assert.match(await readFile(fixture.capture, "utf8"), /generated app/);

  code = await main(await fixture.environment({ status: "ready", action: "closed" }));
  assert.equal(code, 0);
  assert.match(await readFile(fixture.capture, "utf8"), /Preview closed/);
});

test("forked ready PRs analyze successfully without deploying", async () => {
  const fixture = await actionFixture();
  const code = await main(await fixture.environment({ status: "ready", fork: true }));
  assert.equal(code, 0);
  await assert.rejects(readFile(fixture.capture, "utf8"), /ENOENT/);
  assert.match(await readFile(fixture.summary, "utf8"), /forked PRs/);
});

test("Dependabot analyzes without receiving deployment credentials", async () => {
  const fixture = await actionFixture();
  const code = await main(await fixture.environment({ status: "ready", actor: "dependabot[bot]" }));
  assert.equal(code, 0);
  await assert.rejects(readFile(fixture.capture, "utf8"), /ENOENT/);
  assert.match(await readFile(fixture.summary, "utf8"), /Dependabot/);
});

test("a ready same-repository PR fails when Cloudflare is not configured", async () => {
  const fixture = await actionFixture();
  const code = await main(await fixture.environment({ status: "ready", missingCredentials: true }));
  assert.equal(code, 1);
  await assert.rejects(readFile(fixture.capture, "utf8"), /ENOENT/);
  assert.match(await readFile(fixture.summary, "utf8"), /Preview deployment is not configured/);
  assert.match(await readFile(fixture.output, "utf8"), /preview_url=$/m);
});

test("Cloudflare failures fail the check and warn that an older alias may remain", async () => {
  const fixture = await actionFixture();
  const code = await main(await fixture.environment({ status: "ready", deployFail: true }));
  assert.equal(code, 1);
  await assert.rejects(readFile(fixture.capture, "utf8"), /ENOENT/);
  assert.match(await readFile(fixture.summary, "utf8"), /older PR alias may still be visible/i);
});

test("a denied PR comment does not invalidate a successful preview deployment", async () => {
  const fixture = await actionFixture();
  const server = createServer((_request, response) => {
    response.writeHead(403, { "content-type": "application/json" });
    response.end('{"message":"Resource not accessible by integration"}');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address();
    const code = await main(await fixture.environment({
      status: "ready",
      githubToken: "token",
      apiURL: `http://127.0.0.1:${address.port}`,
    }));
    assert.equal(code, 0);
    assert.match(await readFile(fixture.capture, "utf8"), /generated app/);
    assert.match(await readFile(fixture.summary, "utf8"), /PR comment unavailable/);
    assert.match(await readFile(fixture.summary, "utf8"), /pull\\-requests: write/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("malformed analysis and generation errors deploy a static error report", async () => {
  const fixture = await actionFixture();
  let code = await main(await fixture.environment({ malformed: true }));
  assert.equal(code, 1);
  assert.match(await readFile(fixture.capture, "utf8"), /Preview generation failed/);

  code = await main(await fixture.environment({ status: "ready", demoFail: true }));
  assert.equal(code, 1);
  assert.match(await readFile(fixture.capture, "utf8"), /Preview generation failed/);
});

async function actionFixture() {
  const root = await mkdtemp(join(tmpdir(), "pocketstack-action-test-"));
  const workspace = join(root, "workspace");
  const runnerTemp = join(root, "runner");
  const eventPath = join(root, "event.json");
  const output = join(root, "output.txt");
  const summary = join(root, "summary.md");
  const capture = join(root, "deployed.html");
  const cli = join(root, "fake-pocketstack.mjs");
  const npx = join(root, "fake-npx.mjs");
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(runnerTemp, { recursive: true }),
  ]));
  await writeFile(join(workspace, "compose.yaml"), "services: {}\n");
  await writeFile(cli, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const command = process.argv[2];
if (command === "analyze") {
  process.stdout.write(process.env.POCKETSTACK_TEST_MALFORMED === "1" ? "not-json" : process.env.POCKETSTACK_TEST_ANALYSIS);
} else if (command === "demo") {
  if (process.env.POCKETSTACK_TEST_DEMO_FAIL === "1") { process.stderr.write("generation failed"); process.exit(1); }
  const args = process.argv.slice(3); const output = args[args.indexOf("-o") + 1];
  mkdirSync(output, { recursive: true }); writeFileSync(join(output, "index.html"), "<h1>generated app</h1>");
} else { process.exit(2); }
`);
  await writeFile(npx, `#!/usr/bin/env node
import { copyFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2); const directory = args[args.indexOf("deploy") + 1];
if (process.env.POCKETSTACK_TEST_DEPLOY_FAIL === "1") { process.stderr.write("deployment failed"); process.exit(1); }
copyFileSync(join(directory, "index.html"), process.env.POCKETSTACK_TEST_DEPLOY_CAPTURE);
console.log("Deployment complete https://abc123.demo-previews.pages.dev");
`);
  await Promise.all([chmod(cli, 0o755), chmod(npx, 0o755)]);

  return {
    capture,
    output,
    summary,
    async environment({
      status = "ready",
      action = "synchronize",
      fork = false,
      actor = "octocat",
      malformed = false,
      demoFail = false,
      deployFail = false,
      missingCredentials = false,
      githubToken = "",
      apiURL = "",
    } = {}) {
      await Promise.all([
        writeFile(output, ""),
        writeFile(summary, ""),
      ]);
      try { await import("node:fs/promises").then(({ unlink }) => unlink(capture)); } catch {}
      const event = {
        action,
        pull_request: {
          number: 42,
          head: {
            sha: "1234567890abcdef",
            repo: { full_name: fork ? "contributor/fork" : "owner/repo" },
          },
        },
        repository: { full_name: "owner/repo" },
        sender: { login: actor },
      };
      await writeFile(eventPath, JSON.stringify(event));
      const payload = analysis(status);
      payload.projectRoot = workspace;
      payload.composeFile = join(workspace, "compose.yaml");
      return {
        ...process.env,
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_ACTOR: actor,
        ...(apiURL ? { GITHUB_API_URL: apiURL } : {}),
        GITHUB_WORKSPACE: workspace,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        RUNNER_TEMP: runnerTemp,
        INPUT_COMPOSE_FILE: "compose.yaml",
        INPUT_CLOUDFLARE_PROJECT: missingCredentials ? "" : "demo-previews",
        INPUT_CLOUDFLARE_ACCOUNT_ID: missingCredentials ? "" : "account",
        INPUT_CLOUDFLARE_API_TOKEN: missingCredentials ? "" : "token",
        INPUT_GITHUB_TOKEN: githubToken,
        POCKETSTACK_CLI: cli,
        POCKETSTACK_NPX: npx,
        POCKETSTACK_TEST_ANALYSIS: JSON.stringify(payload),
        POCKETSTACK_TEST_MALFORMED: malformed ? "1" : "0",
        POCKETSTACK_TEST_DEMO_FAIL: demoFail ? "1" : "0",
        POCKETSTACK_TEST_DEPLOY_FAIL: deployFail ? "1" : "0",
        POCKETSTACK_TEST_DEPLOY_CAPTURE: capture,
      };
    },
  };
}
