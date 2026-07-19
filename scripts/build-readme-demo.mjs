import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(root, "scripts/readme-demo/index.html");
const outputDirectory = resolve(root, "docs/assets/readme-demo");
const animation = resolve(outputDirectory, "pocketstack-demo.gif");
const poster = resolve(outputDirectory, "pocketstack-demo-poster.webp");
const manifestPath = resolve(outputDirectory, "manifest.json");
const width = 960;
const height = 540;
const fps = 8;
const durationSeconds = 11;
const frameCount = fps * durationSeconds;
const posterFrame = 34;

if (!existsSync(source)) throw new Error(`README demo source is missing: ${source}`);
for (const asset of [
  "web/site/assets/storefront-preview.webp",
  "web/site/assets/sprint-board-preview.webp",
  "web/site/assets/analytics-preview.webp",
  "web/site/fonts/inter.woff2",
]) {
  if (!existsSync(resolve(root, asset))) throw new Error(`README demo source asset is missing: ${asset}`);
}

await mkdir(outputDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(tmpdir(), "pocketstack-readme-demo-"));
const server = createStaticServer(root);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
const browser = await chromium.launch(chromiumOptions());

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`http://127.0.0.1:${address.port}/scripts/readme-demo/index.html`, { waitUntil: "networkidle" });
  const rendererLoaded = await page.evaluate(() => typeof window.renderReadmeDemo === "function" && Boolean(window.README_DEMO_READY));
  if (!rendererLoaded) throw new Error(`README demo renderer did not load${errors.length ? `:\n${errors.join("\n")}` : "."}`);
  await page.evaluate(() => window.README_DEMO_READY);

  for (let frame = 0; frame < frameCount; frame += 1) {
    await page.evaluate((index) => window.renderReadmeDemo(index), frame);
    await page.screenshot({
      path: resolve(temporaryDirectory, `frame-${String(frame).padStart(3, "0")}.png`),
      animations: "disabled",
    });
  }

  if (errors.length > 0) throw new Error(`README demo emitted browser errors:\n${errors.join("\n")}`);

  const inputPattern = resolve(temporaryDirectory, "frame-%03d.png");
  await run("ffmpeg", [
    "-y",
    "-v", "error",
    "-framerate", String(fps),
    "-start_number", "0",
    "-i", inputPattern,
    "-filter_complex",
    "[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
    "-loop", "0",
    "-map_metadata", "-1",
    animation,
  ]);

  await run("ffmpeg", [
    "-y",
    "-v", "error",
    "-i", resolve(temporaryDirectory, `frame-${String(posterFrame).padStart(3, "0")}.png`),
    "-frames:v", "1",
    "-c:v", "libwebp",
    "-compression_level", "6",
    "-quality", "88",
    "-map_metadata", "-1",
    poster,
  ]);

  const animationInfo = await stat(animation);
  const posterInfo = await stat(poster);
  const manifest = {
    asset: "docs/assets/readme-demo/pocketstack-demo.gif",
    poster: "docs/assets/readme-demo/pocketstack-demo-poster.webp",
    generator: "scripts/build-readme-demo.mjs",
    source: "scripts/readme-demo/index.html",
    dimensions: { width, height },
    framesPerSecond: fps,
    frameCount,
    durationSeconds,
    sourceAssets: [
      "web/site/assets/storefront-preview.webp",
      "web/site/assets/sprint-board-preview.webp",
      "web/site/assets/analytics-preview.webp",
      "web/site/fonts/inter.woff2",
    ],
    exactClaims: [
      "Browser-compatible only",
      "Browser readiness 100%",
      "Preview ready",
      "Deployment blocked",
      "Browser readiness 75%",
      "No app preview was published",
    ],
    files: {
      animation: { bytes: animationInfo.size, sha256: await sha256(animation) },
      poster: { bytes: posterInfo.size, sha256: await sha256(poster) },
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${animation} (${formatBytes(animationInfo.size)})`);
  console.log(`Built ${poster} (${formatBytes(posterInfo.size)})`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
  await rm(temporaryDirectory, { recursive: true, force: true });
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

function createStaticServer(directory) {
  const types = {
    ".css": "text/css",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
  };
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    let file = resolve(directory, `.${relative}`);
    if (file !== directory && !file.startsWith(`${directory}/`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = resolve(file, "index.html");
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

async function sha256(file) {
  const contents = await readFile(file);
  return createHash("sha256").update(contents).digest("hex");
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
