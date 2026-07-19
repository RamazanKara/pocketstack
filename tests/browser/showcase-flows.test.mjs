import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(new URL("../..", import.meta.url).pathname);
const applications = [
  {
    name: "storefront",
    directory: resolve(root, "examples/showcase/storefront/dist"),
    port: 4311,
    run: testStorefront,
  },
  {
    name: "sprint board",
    directory: resolve(root, "examples/showcase/sprint-board/dist"),
    port: 4312,
    run: testSprintBoard,
  },
  {
    name: "analytics",
    directory: resolve(root, "examples/showcase/analytics/site"),
    port: 4313,
    run: testAnalytics,
  },
];

for (const application of applications) {
  assert.equal(existsSync(resolve(application.directory, "index.html")), true, `${application.name} must be built before browser testing`);
}

const servers = applications.map((application) => createStaticServer(application.directory, application.port));
await Promise.all(servers.map((server, index) => new Promise((done) => server.listen(applications[index].port, "127.0.0.1", done))));

let browser;
try {
  browser = await chromium.launch(chromiumOptions());
  for (const application of applications) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`http://127.0.0.1:${application.port}`, { waitUntil: "networkidle" });
    assert.ok((await page.locator("body").innerText()).trim().length > 100, `${application.name} rendered blank`);
    await application.run(page);
    assert.deepEqual(errors, [], `${application.name} emitted browser errors`);
    await page.close();
    console.log(`PASS ${application.name}`);
  }
} finally {
  await browser?.close();
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
}

async function testStorefront(page) {
  assert.match(await page.title(), /Storefront/);
  await page.getByPlaceholder("Search products…").first().fill("mug");
  assert.equal(await page.locator(".product-card").count(), 1);
  await assertText(page.locator(".product-card"), /Ceramic Mug/);
  await page.getByPlaceholder("Search products…").first().fill("");
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.getByText("Order placed successfully!").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Close cart" }).click();
  await page.getByRole("button", { name: /Open cart/ }).click();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.getByText("Order placed successfully!").waitFor();
}

async function testSprintBoard(page) {
  assert.match(await page.title(), /Sprint Board/);
  await page.getByRole("button", { name: "New issue" }).click();
  await page.getByPlaceholder("New issue title").fill("Audit preview accessibility");
  await page.getByRole("button", { name: "Add issue" }).click();
  await page.getByText("Audit preview accessibility").waitFor();
  const issue = page.locator(".issue-card", { hasText: "WEB-101" });
  await issue.focus();
  await page.keyboard.press("ArrowRight");
  await page.locator(".column", { has: page.getByRole("heading", { name: /In progress/ }) }).getByText("Improve landing page hero").waitFor();
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("menuitemradio", { name: "Design" }).click();
  assert.ok(await page.locator(".issue-card").count() > 0);
}

async function testAnalytics(page) {
  assert.match(await page.title(), /Analytics/);
  await page.locator("#range-select").selectOption("7");
  assert.equal(await page.locator("#visitors").textContent(), "3,412");
  await page.getByRole("button", { name: /Page/ }).click();
  assert.equal(await page.locator("#pages-body tr").first().locator("td").first().textContent(), "/products");
  await page.locator(".line-point").first().focus();
  assert.equal(await page.locator("#chart-tooltip").evaluate((element) => element.classList.contains("visible")), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#range-select").selectOption("90");
  assert.equal(await page.locator("#visitors").textContent(), "34,872");
}

async function assertText(locator, pattern) {
  assert.match((await locator.textContent()) || "", pattern);
}

function chromiumOptions() {
  const executablePath = [
    process.env.CHROME_BIN,
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean).find((candidate) => existsSync(candidate));
  return executablePath ? { executablePath, args: ["--no-sandbox"] } : {};
}

function createStaticServer(directory, port) {
  const baseURL = `http://127.0.0.1:${port}`;
  const types = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
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
      response.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}
