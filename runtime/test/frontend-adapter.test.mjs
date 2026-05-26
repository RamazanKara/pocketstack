import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";

async function loadFrontendModule() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/frontend-adapter.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("frontend adapter distinguishes text and binary project files", async () => {
  const { isTextProjectFile } = await loadFrontendModule();
  assert.equal(isTextProjectFile("package.json"), true);
  assert.equal(isTextProjectFile("src/App.tsx"), true);
  assert.equal(isTextProjectFile("public/logo.svg"), true);
  assert.equal(isTextProjectFile("public/logo.png"), false);
  assert.equal(isTextProjectFile("public/font.woff2"), false);
});

test("frontend adapter builds nested WebContainer mount trees", async () => {
  const { createWebContainerTree } = await loadFrontendModule();
  const binary = new Uint8Array([1, 2, 3]);
  const tree = await createWebContainerTree({
    files: ["package.json", "src/main.jsx", "public/logo.png"],
  }, async (file) => {
    if (file.endsWith(".png")) return binary;
    return `${file}:contents`;
  });

  assert.deepEqual(tree, {
    "package.json": { file: { contents: "package.json:contents" } },
    src: {
      directory: {
        "main.jsx": { file: { contents: "src/main.jsx:contents" } },
      },
    },
    public: {
      directory: {
        "logo.png": { file: { contents: binary } },
      },
    },
  });
});

test("frontend adapter injects PocketStack bridge assets for browser services", async () => {
  const { createWebContainerTree, frontendBridgeOptions, frontendBridgeServices, injectFrontendBridge, isHTMLFile } = await loadFrontendModule();
  const services = [
    { name: "api", adapter: "mock-http", publicPort: 8080 },
    { name: "db", adapter: "postgres-pglite", publicPort: 5432 },
    { name: "worker", adapter: "wasi" },
  ];
  const options = frontendBridgeOptions(services);
  const tree = await createWebContainerTree({
    files: ["index.html", "pages/admin.htm", "src/main.jsx"],
  }, async (file) => {
    if (file === "index.html") return "<html><head><title>Demo</title></head><body></body></html>";
    if (file.endsWith(".htm")) return "<body>admin</body>";
    return "console.log('demo')";
  }, options);

  assert.deepEqual(frontendBridgeServices(services), [
    { name: "api", adapter: "mock-http", publicPort: 8080 },
    { name: "db", adapter: "postgres-pglite", publicPort: 5432 },
  ]);
  assert.match(tree["index.html"].file.contents, /__POCKETSTACK_BRIDGE_CONFIG__/);
  assert.match(tree["index.html"].file.contents, /__pocketstack_bridge\.js/);
  assert.match(tree.pages.directory["admin.htm"].file.contents, /__POCKETSTACK_BRIDGE_CONFIG__/);
  assert.match(tree["__pocketstack_bridge.js"].file.contents, /POCKETSTACK_BRIDGE_FETCH/);
  assert.match(tree["__pocketstack_bridge.js"].file.contents, /window\.fetch/);
  assert.equal(isHTMLFile("pages/admin.htm"), true);
  assert.equal(isHTMLFile("src/main.jsx"), false);
  assert.equal(
    injectFrontendBridge("<body>hi</body>", "{\"services\":[]}").startsWith("<body><script>"),
    true,
  );
});

test("frontend adapter rejects unsafe project paths", async () => {
  const { createWebContainerTree } = await loadFrontendModule();
  await assert.rejects(
    () => createWebContainerTree({ files: ["../secret.env"] }, async () => ""),
    /invalid project file path/,
  );
});

test("frontend adapter splits quoted and escaped commands", async () => {
  const { splitCommand } = await loadFrontendModule();

  assert.deepEqual(splitCommand("npm run dev -- --host 0.0.0.0"), [
    "npm",
    "run",
    "dev",
    "--",
    "--host",
    "0.0.0.0",
  ]);
  assert.deepEqual(splitCommand('sh -c "npm install && npm run dev"'), [
    "sh",
    "-c",
    "npm install && npm run dev",
  ]);
  assert.deepEqual(splitCommand("node scripts/serve\\ preview.js"), [
    "node",
    "scripts/serve preview.js",
  ]);
});

test("frontend adapter parses Compose environment for WebContainer spawn", async () => {
  const { frontendEnvironment } = await loadFrontendModule();

  assert.deepEqual(frontendEnvironment("VITE_API_URL=https://api.example.test\nVITE_FLAG=true"), {
    VITE_API_URL: "https://api.example.test",
    VITE_FLAG: "true",
  });
  assert.deepEqual(frontendEnvironment(["NODE_ENV=development", "EMPTY"]), {
    NODE_ENV: "development",
    EMPTY: "",
  });
  assert.deepEqual(frontendEnvironment({ PORT: 5173, DEBUG: false }), {
    PORT: "5173",
    DEBUG: "false",
  });
});
