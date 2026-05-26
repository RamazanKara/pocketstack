import { createServer } from "node:http";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import puppeteer from "puppeteer-core";

const root = resolve(new URL("..", import.meta.url).pathname);
const studioDir = join(root, "studio");
const mediaDir = join(root, "docs", "media");
const framesDir = join(mediaDir, "frames-announcement");
const videoPath = join(mediaDir, "pocketstack-announcement.mp4");
const posterPath = join(mediaDir, "pocketstack-announcement-poster.png");
const port = Number(process.env.POCKETSTACK_MEDIA_PORT || 4197);
const baseURL = `http://127.0.0.1:${port}`;
const frameRate = 12;

const compose = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./site:/usr/share/nginx/html:ro
  app:
    image: node:22-alpine
    working_dir: /app
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://api:8080
    volumes:
      - ./app:/app
  api:
    image: scratch
    labels:
      pocketstack.adapter: mock-http
      pocketstack.mock.openapi: openapi.yaml
      pocketstack.mock.fixtures: fixtures
      pocketstack.mock.port: "8080"
  db:
    image: postgres:16
    ports:
      - "5432:5432"
    volumes:
      - ./db:/docker-entrypoint-initdb.d:ro
    labels:
      pocketstack.db.persist: indexeddb
`;

let frame = 0;

await mkdir(mediaDir, { recursive: true });
await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
const tempRoot = await mkdtemp(join(tmpdir(), "pocketstack-media-"));
const generatedDemoDir = join(tempRoot, "generated-demo");
await run("go", [
  "run",
  "./cmd/pocketstack",
  "demo",
  "-f",
  "examples/static-site/compose.yaml",
  "-o",
  generatedDemoDir,
], { cwd: root });

const server = createStaticServer({ studioDir, generatedDemoDir });
await new Promise((resolveListen) => server.listen(port, "127.0.0.1", resolveListen));

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,720"],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  await page.goto(baseURL, { waitUntil: "networkidle2" });
  await page.evaluate(() => {
    document.body.style.zoom = "0.86";
  });
  await captureHold(page, 1.2);

  await page.click("#compose-text");
  await captureDuring(page, () => page.type("#compose-text", compose, { delay: 3 }));
  await captureHold(page, 0.6);

  await page.evaluate(() => document.querySelector("#sample-button").click());
  await page.waitForFunction(() => document.querySelector("#mode-value")?.textContent === "browser-native");
  await page.waitForFunction(() => document.querySelector("#ready-count")?.textContent === "4");
  await captureHold(page, 3.8);

  await page.goto(`${baseURL}/demo/index.html`, { waitUntil: "networkidle2" });
  await page.evaluate(() => {
    document.body.style.zoom = "0.9";
  });
  await captureHold(page, 3.4);

  await page.goto(`${baseURL}/demo/pocketstack.manifest.json`, { waitUntil: "networkidle2" });
  await captureHold(page, 2.8);

  await page.goto(`${baseURL}/demo/assets/web/static/index.html`, { waitUntil: "networkidle2" });
  await captureHold(page, 3.0);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(tempRoot, { recursive: true, force: true });
}

await renderVideo();
await rm(framesDir, { recursive: true, force: true });
console.log(`Rendered ${videoPath}`);
console.log(`Rendered ${posterPath}`);

async function captureDuring(page, action) {
  let done = false;
  const actionPromise = Promise.resolve(action()).finally(() => {
    done = true;
  });
  while (!done) {
    await captureFrame(page);
    await delay(1000 / frameRate);
  }
  await actionPromise;
}

async function captureHold(page, seconds) {
  const count = Math.max(1, Math.round(seconds * frameRate));
  for (let index = 0; index < count; index += 1) {
    await captureFrame(page);
    await delay(1000 / frameRate);
  }
}

async function captureFrame(page) {
  frame += 1;
  await page.screenshot({
    path: join(framesDir, `frame-${String(frame).padStart(5, "0")}.png`),
  });
}

async function renderVideo() {
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    String(frameRate),
    "-i",
    join(framesDir, "frame-%05d.png"),
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-movflags",
    "+faststart",
    videoPath,
  ]);
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "00:00:08",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    posterPath,
  ]);
}

function createStaticServer({ studioDir, generatedDemoDir }) {
  const types = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
  };
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", baseURL);
    const route = routeStaticFile(url.pathname, studioDir, generatedDemoDir);
    if (!route) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const { directory, path } = route;
    try {
      await access(path);
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

function routeStaticFile(pathname, studioDirectory, demoDirectory) {
  if (pathname.startsWith("/demo/")) {
    const relative = pathname.slice("/demo".length) || "/index.html";
    const path = resolve(demoDirectory, `.${decodeURIComponent(relative)}`);
    if (!path.startsWith(demoDirectory)) return null;
    return { directory: demoDirectory, path };
  }
  const relative = pathname === "/" ? "/index.html" : pathname;
  const path = resolve(studioDirectory, `.${decodeURIComponent(relative)}`);
  if (!path.startsWith(studioDirectory)) return null;
  return { directory: studioDirectory, path };
}

function chromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error("Chromium or Chrome was not found. Set CHROME_BIN to record the announcement demo.");
  }
  return path;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${code}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
