import { createServer } from "node:http";
import { access, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";

const root = resolve(new URL("../..", import.meta.url).pathname);
const pagesDir = resolve(root, "dist", "pages");
const port = Number(process.env.POCKETSTACK_BROWSER_TEST_PORT || 4297);
const baseURL = `http://127.0.0.1:${port}`;
const requireAll = process.env.POCKETSTACK_REQUIRE_BROWSERS === "1";

const browsers = [
  {
    name: "Chrome",
    launch: () => chromium.launch(withLocalhostProxyBypass(chromeLaunchOptions())),
    dynamicStudio: true,
  },
  {
    name: "Edge",
    launch: () => chromium.launch(withLocalhostProxyBypass(edgeLaunchOptions())),
    dynamicStudio: true,
  },
  {
    name: "Safari/WebKit",
    launch: () => webkit.launch(withLocalhostProxyBypass()),
    dynamicStudio: false,
  },
];

const server = createStaticServer(pagesDir);
await new Promise((resolveListen) => server.listen(port, "127.0.0.1", resolveListen));

const results = [];
try {
  for (const browser of browsers) {
    results.push(await runBrowser(browser));
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

const failed = results.filter((result) => result.status === "failed");
const skipped = results.filter((result) => result.status === "skipped");
for (const result of results) {
  console.log(`${result.status.toUpperCase()} ${result.name}${result.message ? `: ${result.message}` : ""}`);
}
if (failed.length > 0 || (requireAll && skipped.length > 0)) {
  process.exitCode = 1;
}

async function runBrowser(browserConfig) {
  let browser;
  try {
    browser = await browserConfig.launch();
  } catch (error) {
    return { name: browserConfig.name, status: "skipped", message: error.message };
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await assertText(page, "h1", /Docker Compose projects/);
    await page.goto(`${baseURL}/studio/`, { waitUntil: "networkidle" });
    await assertText(page, "h1", /PocketStack Studio/);
    if (browserConfig.dynamicStudio) {
      await page.click("#sample-button");
      await page.waitForFunction(() => document.querySelector("#mode-value")?.textContent === "browser-native");
      assert.equal(await page.locator("#ready-count").textContent(), "4");
    }
    await page.goto(`${baseURL}/demos/static-site/`, { waitUntil: "networkidle" });
    await assertText(page, "body", /PocketStack Demo/);
    await assertText(page.frameLocator('iframe[title="web preview"]'), "h1", /Hello from PocketStack/);
    await page.goto(`${baseURL}/demos/static-site/pocketstack.manifest.json`, { waitUntil: "networkidle" });
    await assertText(page, "body", /"browserOnly": true/);
    return { name: browserConfig.name, status: "passed" };
  } catch (error) {
    return { name: browserConfig.name, status: "failed", message: error.stack || error.message };
  } finally {
    await browser.close();
  }
}

async function assertText(page, selector, pattern) {
  const text = await page.locator(selector).first().textContent();
  assert.match(text || "", pattern);
}

function chromeLaunchOptions() {
  const executablePath = [
    process.env.CHROME_BIN,
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean).find((candidate) => existsSync(candidate));
  return executablePath ? { executablePath, args: ["--no-sandbox"] } : {};
}

function edgeLaunchOptions() {
  const executablePath = [
    process.env.EDGE_BIN,
    "/opt/microsoft/msedge/msedge",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
  ].filter(Boolean).find((candidate) => existsSync(candidate));
  return executablePath ? { executablePath, args: ["--no-sandbox"] } : { channel: "msedge" };
}

function withLocalhostProxyBypass(options = {}) {
  return {
    ...options,
    env: {
      ...process.env,
      NO_PROXY: appendProxyBypass(process.env.NO_PROXY),
      no_proxy: appendProxyBypass(process.env.no_proxy),
    },
  };
}

function appendProxyBypass(value = "") {
  const entries = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  for (const host of ["127.0.0.1", "localhost"]) {
    if (!entries.includes(host)) entries.push(host);
  }
  return entries.join(",");
}

function createStaticServer(directory) {
  const types = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mp4": "video/mp4",
    ".png": "image/png",
  };
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", baseURL);
    const relative = url.pathname === "/" ? "/index.html" : url.pathname;
    let path = resolve(directory, `.${decodeURIComponent(relative)}`);
    if (!path.startsWith(directory)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      await access(path);
      const info = await stat(path);
      if (info.isDirectory()) path = resolve(path, "index.html");
      response.writeHead(200, {
        "content-type": types[extname(path)] || "application/octet-stream",
      });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}
