import * as YAML from "https://esm.sh/js-yaml@4.1.0";

const ADAPTERS = {
  staticWeb: "static-web",
  frontend: "frontend",
  wasi: "wasi",
  mockHTTP: "mock-http",
  postgres: "postgres-pglite",
  sqlite: "sqlite",
  unsupported: "unsupported",
};

const LABELS = {
  adapter: "pocketstack.adapter",
  frontendInstall: "pocketstack.frontend.install",
  frontendStart: "pocketstack.frontend.start",
  frontendPort: "pocketstack.frontend.port",
  wasiModule: "pocketstack.wasi.module",
  wasiArgs: "pocketstack.wasi.args",
  mockOpenAPI: "pocketstack.mock.openapi",
  mockFixtures: "pocketstack.mock.fixtures",
  mockPort: "pocketstack.mock.port",
  dbInit: "pocketstack.db.init",
  dbSeed: "pocketstack.db.seed",
  dbPersist: "pocketstack.db.persist",
};

const SUPPORTED_EXPLICIT = new Set([
  ADAPTERS.frontend,
  ADAPTERS.wasi,
  ADAPTERS.mockHTTP,
  ADAPTERS.postgres,
  ADAPTERS.sqlite,
]);

const ENV_FILE_WARNING = "env_file values are embedded in the static demo; do not include secrets.";
const POSTGRES_INIT_TARGET = "/docker-entrypoint-initdb.d";

const els = {
  composeFile: document.querySelector("#compose-file"),
  composeName: document.querySelector("#compose-name"),
  composeText: document.querySelector("#compose-text"),
  composeMeta: document.querySelector("#compose-input-meta"),
  projectFolder: document.querySelector("#project-folder"),
  folderCount: document.querySelector("#folder-count"),
  analyzeButton: document.querySelector("#analyze-button"),
  sampleButton: document.querySelector("#sample-button"),
  clearButton: document.querySelector("#clear-button"),
  dropZone: document.querySelector("#drop-zone"),
  modeValue: document.querySelector("#mode-value"),
  readinessScore: document.querySelector("#readiness-score"),
  serviceCount: document.querySelector("#service-count"),
  readyCount: document.querySelector("#ready-count"),
  needsCount: document.querySelector("#needs-count"),
  notice: document.querySelector("#notice"),
  serviceList: document.querySelector("#service-list"),
  previewPanel: document.querySelector("#preview-panel"),
  previewLabel: document.querySelector("#preview-label"),
  manifestOutput: document.querySelector("#manifest-output"),
  downloadButton: document.querySelector("#download-button"),
};

const state = {
  composeFile: null,
  composeText: "",
  composeName: "browser-upload",
  projectFiles: [],
  analysis: null,
};

const sampleCompose = `services:
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

const sampleProjectFiles = [
  sampleFile("site/index.html", `<!doctype html>
<html>
  <head>
    <title>PocketStack Sample</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #0d1b1f; color: white; }
      main { min-height: 100vh; display: grid; place-items: center; text-align: center; }
      h1 { font-size: 44px; margin: 0 0 12px; }
      p { margin: 0; color: #9ee8d4; font-size: 22px; }
    </style>
  </head>
  <body>
    <main>
      <div>
        <h1>Static preview is live</h1>
        <p>This came from a Compose document-root mount.</p>
      </div>
    </main>
  </body>
</html>`),
  sampleFile("app/package.json", JSON.stringify({
    scripts: { dev: "vite" },
    dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", react: "latest", "react-dom": "latest" },
    devDependencies: {},
  }, null, 2)),
  sampleFile("app/index.html", `<main id="root">PocketStack sample frontend</main><script type="module" src="/src/main.jsx"></script>`),
  sampleFile("app/src/main.jsx", `fetch(import.meta.env.VITE_API_URL + "/health").then((response) => response.json()).then((body) => {
  document.querySelector("#root").textContent = "API says: " + body.status;
});`),
  sampleFile("openapi.yaml", `openapi: 3.0.3
info:
  title: PocketStack Sample API
  version: 1.0.0
paths:
  /health:
    get:
      responses:
        "200":
          description: OK
          content:
            application/json:
              example:
                status: ok
`),
  sampleFile("fixtures/health.json", `{"method":"GET","path":"/health","body":{"status":"ok","source":"fixture"}}`),
  sampleFile("db/init.sql", "create table todos (id serial primary key, title text not null);\ninsert into todos (title) values ('Record a PocketStack demo');\n"),
];

els.composeFile.addEventListener("change", async () => {
  const [file] = els.composeFile.files;
  if (!file) return;
  await setComposeFile(file);
});

els.composeText.addEventListener("input", () => {
  state.composeText = els.composeText.value;
  if (!state.composeText.trim()) {
    state.composeFile = null;
    state.composeName = "browser-upload";
  } else if (!state.composeFile) {
    state.composeName = "pasted-compose.yaml";
  }
  updateComposeMeta();
  showNotice("");
});

els.projectFolder.addEventListener("change", () => {
  state.projectFiles = [...els.projectFolder.files];
  els.folderCount.textContent = folderLabel(state.projectFiles.length);
});

els.analyzeButton.addEventListener("click", () => analyzeCurrentProject());
els.sampleButton.addEventListener("click", () => {
  setComposeText(sampleCompose, "sample-compose.yaml");
  state.projectFiles = sampleProjectFiles;
  els.folderCount.textContent = `${sampleProjectFiles.length} sample files loaded`;
  analyzeCurrentProject();
});

els.clearButton.addEventListener("click", () => {
  state.composeFile = null;
  state.composeText = "";
  state.composeName = "browser-upload";
  els.composeFile.value = "";
  els.composeText.value = "";
  els.projectFolder.value = "";
  state.projectFiles = [];
  els.folderCount.textContent = folderLabel(0);
  state.analysis = null;
  updateComposeMeta();
  renderEmptyState();
  showNotice("");
});

els.downloadButton.addEventListener("click", () => {
  if (!state.analysis) return;
  const blob = new Blob([JSON.stringify(state.analysis.manifest, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pocketstack.manifest.json";
  link.click();
  URL.revokeObjectURL(url);
});

for (const eventName of ["dragenter", "dragover"]) {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragging");
  });
}

els.dropZone.addEventListener("drop", async (event) => {
  const file = [...event.dataTransfer.files].find((item) =>
    /\.(ya?ml)$/i.test(item.name),
  );
  if (!file) {
    showNotice("Drop a .yaml or .yml Compose file.");
    return;
  }
  await setComposeFile(file);
  analyzeCurrentProject();
});

async function setComposeFile(file) {
  setComposeText(await file.text(), file.name, file);
  showNotice("");
}

function setComposeText(text, name, file = null) {
  state.composeFile = file;
  state.composeText = text;
  state.composeName = name || "pasted-compose.yaml";
  if (!file) els.composeFile.value = "";
  els.composeText.value = text;
  updateComposeMeta();
}

function sampleFile(path, content) {
  const name = path.split("/").pop() || path;
  return {
    name,
    pocketstackPath: path,
    async text() {
      return content;
    },
  };
}

function updateComposeMeta() {
  const text = els.composeText.value;
  const trimmed = text.trim();
  const lines = trimmed ? text.split(/\r?\n/).length : 0;
  const bytes = new Blob([text]).size;
  els.composeName.textContent = state.composeName || "pasted-compose.yaml";
  els.composeMeta.textContent = trimmed
    ? `${lines} line${lines === 1 ? "" : "s"}, ${bytes} byte${bytes === 1 ? "" : "s"}`
    : "Paste YAML here or upload a file.";
}

async function analyzeCurrentProject() {
  state.composeText = els.composeText.value;
  if (!state.composeText.trim()) {
    showNotice("Paste Compose YAML or choose a Compose file first.");
    return;
  }

  try {
    const project = YAML.load(state.composeText);
    if (!project || typeof project !== "object" || !project.services) {
      throw new Error("Compose file has no services block.");
    }
    const fileIndex = createFileIndex(state.projectFiles);
    const analysis = await analyzeProject(project, state.composeName, fileIndex);
    state.analysis = analysis;
    renderAnalysis(analysis, fileIndex);
  } catch (error) {
    state.analysis = null;
    renderError(error);
  }
}

async function analyzeProject(project, composeName, fileIndex) {
  const serviceNames = Object.keys(project.services || {}).sort();
  const services = [];

  for (const name of serviceNames) {
    services.push(await analyzeService(name, project.services[name] || {}, fileIndex));
  }

  const browserNative = services.every((service) => service.browserNative);
  const mode = browserNative ? "browser-native" : "unsupported";
  const readiness = browserReadiness(services);
  const nextSteps = projectNextSteps(services);
  const hostRequirements = services.reduce(
    (merged, service) => mergeHostRequirements(merged, service.hostRequirements),
    {},
  );
  const warnings = [];
  if (!browserNative) {
    warnings.push(
      "PocketStack Studio found services that need uploaded project files or adapter changes before a static demo can be generated.",
    );
  }
  if (hostRequirements.crossOriginIsolationRequired) {
    warnings.push("Some generated demos need COOP/COEP headers for cross-origin isolation.");
  }
  if (hostRequirements.networkAccessRequired) {
    warnings.push("Some browser runtimes may fetch public npm/runtime packages.");
  }
  if (usesFrontendBridge(services)) {
    warnings.push("WebContainer frontend demos use a generated bridge for known mock/database demo endpoints.");
  }
  const storageNamespace = await demoStorageNamespace(composeName, fileIndex);

  const manifest = {
    version: "2",
    generatedAt: new Date().toISOString(),
    mode,
    browserOnly: true,
    composeFile: composeName,
    storageNamespace,
    readiness,
    hostRequirements,
    warnings,
    nextSteps,
    services: services.map((service) => toManifestService(service, storageNamespace)),
  };

  return {
    composeFile: composeName,
    mode,
    browserNative,
    readiness,
    hostRequirements,
    warnings,
    nextSteps,
    services,
    manifest,
  };
}

async function analyzeService(name, rawService, fileIndex) {
  const service = normalizeService(rawService);
  const labels = labelMap(service.labels);
  const explicit = (labels[LABELS.adapter] || "").trim();
  const context = { name, service, labels, explicit, fileIndex };

  if (explicit) {
    const adapter = adapterRegistry().find((item) => item.name === explicit);
    if (!adapter || !SUPPORTED_EXPLICIT.has(explicit)) {
      const reason = explicit === ADAPTERS.staticWeb
        ? "static-web is autodetected; do not set pocketstack.adapter=static-web"
        : `unknown PocketStack adapter "${explicit}"`;
      return unsupportedResult(context, reason);
    }
    const result = await adapter.analyze(context);
    if (!result.browserNative) result.suggestions = suggestionsForService(context, result.unsupported);
    return result;
  }

  const rejected = [];
  for (const adapter of adapterRegistry()) {
    const result = await adapter.analyze(context);
    if (result.browserNative || result.status === "needs-files") {
      if (!result.browserNative) result.suggestions = suggestionsForService(context, result.unsupported);
      return result;
    }
    rejected.push(...result.unsupported);
  }

  const result = baseServiceAnalysis(context, ADAPTERS.unsupported);
  result.browserNative = false;
  result.status = "unsupported";
  result.unsupported = primaryUnsupportedReasons(context, rejected);
  if (result.unsupported.length === 0) {
    result.unsupported.push("no browser adapter matched this service");
  }
  result.suggestions = suggestionsForService(context, result.unsupported);
  return result;
}

function adapterRegistry() {
  return [
    { name: ADAPTERS.staticWeb, analyze: analyzeStaticWeb },
    { name: ADAPTERS.frontend, analyze: analyzeFrontend },
    { name: ADAPTERS.wasi, analyze: analyzeWASI },
    { name: ADAPTERS.mockHTTP, analyze: analyzeMockHTTP },
    { name: ADAPTERS.postgres, analyze: analyzePostgres },
    { name: ADAPTERS.sqlite, analyze: analyzeSQLite },
  ];
}

async function analyzeStaticWeb(context) {
  const result = baseServiceAnalysis(context, ADAPTERS.staticWeb);
  const { service, fileIndex } = context;

  if (service.image === "") reject(result, "static-web requires an image such as nginx, httpd, or caddy");
  if (hasValue(service.build)) reject(result, "static-web cannot run Docker build contexts in the browser");
  if (hasValue(service.command)) reject(result, "static-web cannot execute custom commands");
  if (hasValue(service.entrypoint)) reject(result, "static-web cannot execute custom entrypoints");
  if (!isStaticWebImage(service.image)) {
    reject(result, `image "${service.image}" is not in the static-web allowlist`);
  }
  if (result.status === "unsupported") return result;

  const staticTargets = staticTargetsForImage(service.image);
  const configTargets = configTargetsForImage(service.image);
  const volumes = parseVolumes(service.volumes);
  const ignoredConfigMounts = volumes
    .filter((item) => item.isBindLike && matchesStaticConfigTarget(configTargets, item.target))
    .map((item) => item.target)
    .sort();
  if (ignoredConfigMounts.length > 0) {
    result.config.ignoredConfigMounts = ignoredConfigMounts.join("\n");
    result.warnings.push(
      "static-web packages document-root files only; mounted nginx/httpd/caddy config is not emulated, so redirects, rewrites, custom headers, auth, and compression may differ.",
    );
  }
  result.publicPort = firstPort(service, defaultPortForImage(service.image));

  const staticAssets = [];
  let indexFile = null;
  for (const volume of volumes) {
    if (!volume.isBindLike) continue;
    const mount = staticDocumentMount(staticTargets, volume.target);
    if (!mount) continue;
    const source = volume.source || ".";
    if (!fileIndex.hasUploads) {
      needsFiles(result, `Upload the project folder so Studio can read ${source}.`);
      return result;
    }
    const direct = fileIndex.fileAt(source);
    const target = staticAssetTarget(source, mount.relative, Boolean(direct));
    if (!result.staticRoot) result.staticRoot = mount.root;
    if (!result.assetSource) result.assetSource = source;
    if (direct) {
      staticAssets.push(asset("static", "file", source, target, [direct]));
      if (target === "static/index.html") indexFile = direct;
      continue;
    }
    const files = fileIndex.filesUnder(source);
    if (files.length === 0) {
      needsFiles(result, `No uploaded files were found under ${source}.`);
      return result;
    }
    staticAssets.push(asset("static", "directory", source, target, files));
    if (target === "static") {
      indexFile = fileIndex.fileAt(joinPath(source, "index.html")) || indexFile;
    }
  }

  if (staticAssets.length === 0) {
    reject(result, "no local static asset file or directory is mounted at the image's document root");
    return result;
  }

  result.assets.push(...staticAssets);
  if (indexFile) {
    result.browserPath = `uploaded://${indexFile.path}`;
    result.preview = { type: "static", indexPath: indexFile.path };
  } else {
    result.warnings.push("Static assets were found, but index.html was not present at the mounted root.");
  }
  return result;
}

function staticDocumentMount(staticTargets, target) {
  for (const root of staticTargets) {
    const relative = containerRelativePath(root, target);
    if (relative !== null) return { root: cleanAbsolutePath(root), relative };
  }
  return null;
}

function staticAssetTarget(source, relative, isFile) {
  if (!relative || relative === ".") {
    return isFile ? joinPath("static", basename(source)) : "static";
  }
  return joinPath("static", relative);
}

async function analyzeFrontend(context) {
  const result = baseServiceAnalysis(context, ADAPTERS.frontend);
  const { service, labels, fileIndex, explicit } = context;

  if (hasValue(service.build)) {
    reject(result, "frontend adapter requires a local source mount, not a Docker build context");
  }
  if (explicit === "" && !isFrontendImage(service.image)) {
    reject(result, `image "${service.image}" is not a Node/Bun frontend image`);
  }
  if (result.status === "unsupported") return result;

  const source = frontendSource(service, fileIndex, "package.json");
  if (!source) {
    needsFiles(
      result,
      fileIndex.hasUploads
        ? "No package.json was found in the project root or a bind-mounted source directory."
        : "Upload the project folder so Studio can find package.json.",
    );
    return result;
  }

  const packageEntry = fileIndex.fileAt(joinPath(source, "package.json"));
  let packageJSON;
  try {
    packageJSON = JSON.parse(await packageEntry.file.text());
  } catch (error) {
    reject(result, `parse package.json: ${error.message}`);
    return result;
  }

  const scripts = packageJSON.scripts || {};
  const manager = detectPackageManager(fileIndex, source, service.image, packageJSON.packageManager);
  let start = frontendStartCommand(labels, service.entrypoint, service.command);
  if (!start) {
    if (scripts.dev) start = defaultRunCommand(manager, "dev");
    else if (scripts.start) start = defaultRunCommand(manager, "start");
    else reject(result, "frontend adapter requires a dev/start script or pocketstack.frontend.start label");
  }
  if (result.status === "unsupported") return result;

  result.assetSource = source;
  result.publicPort = labelInt(labels, LABELS.frontendPort, firstPort(service, 3000));
  result.config.install = frontendInstallCommand(labels, fileIndex, source, manager, start);
  result.config.start = start;
  result.config.port = String(result.publicPort);
  result.config.packageManager = manager;
  const env = await serviceEnvironmentList(service, fileIndex, result);
  if (result.status !== "ready") return result;
  if (env.length > 0) result.config.env = env.join("\n");
  result.assets.push(asset("project", "directory", source, "project", fileIndex.filesUnder(source)));
  result.hostRequirements = {
    crossOriginIsolationRequired: true,
    networkAccessRequired: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  };
  return result;
}

function frontendStartCommand(labels, entrypoint, composeCommand) {
  const labeled = String(labels[LABELS.frontendStart] || "").trim();
  return labeled || composeEntrypointCommandString(entrypoint, composeCommand);
}

function frontendInstallCommand(labels, fileIndex, source, manager, start) {
  const labeled = String(labels[LABELS.frontendInstall] || "").trim();
  if (labeled) return labeled;
  if (frontendCommandInstallsDependencies(start)) return "";
  return defaultInstallCommand(fileIndex, source, manager);
}

async function analyzeWASI(context) {
  const result = baseServiceAnalysis(context, ADAPTERS.wasi);
  const { service, labels, fileIndex, explicit } = context;
  if (explicit !== ADAPTERS.wasi) {
    reject(result, "wasi adapter requires pocketstack.adapter=wasi");
    return result;
  }

  const modulePath = (labels[LABELS.wasiModule] || "").trim();
  if (!modulePath) {
    reject(result, "wasi adapter requires pocketstack.wasi.module");
    return result;
  }
  if (!modulePath.endsWith(".wasm")) {
    reject(result, "pocketstack.wasi.module must point to a prebuilt .wasm file");
    return result;
  }
  const moduleEntry = fileIndex.fileAt(modulePath);
  if (!moduleEntry) {
    needsFiles(result, `Upload the project folder containing ${modulePath}.`);
    return result;
  }

  result.config.args = labels[LABELS.wasiArgs] || "";
  const env = await serviceEnvironmentList(service, fileIndex, result);
  if (result.status !== "ready") return result;
  if (env.length > 0) result.config.env = env.join("\n");
  result.config.modulePath = `uploaded://${moduleEntry.path}`;
  result.assets.push(asset("module", "file", modulePath, "module.wasm", [moduleEntry]));
  result.hostRequirements = {
    crossOriginIsolationRequired: true,
    networkAccessRequired: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  };
  return result;
}

async function analyzeMockHTTP(context) {
  const result = baseServiceAnalysis(context, ADAPTERS.mockHTTP);
  const { service, labels, fileIndex, explicit } = context;
  if (explicit !== ADAPTERS.mockHTTP) {
    reject(result, "mock-http adapter requires pocketstack.adapter=mock-http");
    return result;
  }

  const openAPI = (labels[LABELS.mockOpenAPI] || "").trim();
  const fixtures = (labels[LABELS.mockFixtures] || "").trim();
  if (!openAPI && !fixtures) {
    reject(result, "mock-http adapter requires pocketstack.mock.openapi or pocketstack.mock.fixtures");
    return result;
  }

  if (openAPI) {
    const entry = fileIndex.fileAt(openAPI);
    if (!entry) needsFiles(result, `Upload the project folder containing ${openAPI}.`);
    else if (!isOpenAPIPath(openAPI)) reject(result, `OpenAPI file ${openAPI} must be .yaml, .yml, or .json`);
    else result.assets.push(asset("openapi", "file", openAPI, `openapi${extension(openAPI)}`, [entry]));
  }

  if (fixtures) {
    const files = fileIndex.filesUnder(fixtures);
    if (files.length === 0) needsFiles(result, `Upload JSON fixtures under ${fixtures}.`);
    else {
      const jsonFiles = files.filter((entry) => isJSONPath(entry.path));
      if (jsonFiles.length === 0) {
        const message = `fixtures directory ${fixtures} has no .json files PocketStack can serve`;
        if (!openAPI) reject(result, message);
        else result.warnings.push(message);
      } else {
        if (jsonFiles.length < files.length) {
          result.warnings.push(`fixtures directory ${fixtures} includes non-.json files that are not served by mock-http.`);
        }
        result.assets.push(asset("fixtures", "json-directory", fixtures, "fixtures", jsonFiles));
      }
    }
  }

  result.publicPort = labelInt(labels, LABELS.mockPort, firstPort(service, 8080));
  result.config.port = String(result.publicPort);
  return result;
}

async function analyzePostgres(context) {
  const result = baseServiceAnalysis(context, ADAPTERS.postgres);
  const { service, labels, fileIndex, explicit } = context;

  if (explicit === "" && normalizedImage(service.image) !== "postgres") {
    reject(result, `image "${service.image}" is not postgres`);
  }
  if (hasValue(service.build)) reject(result, "postgres-pglite cannot run Docker build contexts");
  if (result.status === "unsupported") return result;

  if (hasValue(service.command) || hasValue(service.entrypoint)) {
    result.warnings.push("Postgres command/entrypoint is ignored by the PGlite adapter.");
  }

  result.publicPort = firstPort(service, 5432);
  const persist = dbPersistMode(labels, result);
  if (result.status === "unsupported") return result;
  result.config.persist = persist;
  addOptionalSQLPath(result, fileIndex, labels[LABELS.dbInit], "init", "init.sql", false);
  addOptionalSQLPath(result, fileIndex, labels[LABELS.dbSeed], "seed", "seed.sql", false);
  addPostgresInitMounts(result, fileIndex, service);
  result.hostRequirements.networkAccessRequired = true;
  return result;
}

async function analyzeSQLite(context) {
  const result = baseServiceAnalysis(context, ADAPTERS.sqlite);
  const { labels, fileIndex, explicit } = context;
  if (explicit !== ADAPTERS.sqlite) {
    reject(result, "sqlite adapter requires pocketstack.adapter=sqlite");
    return result;
  }

  const persist = dbPersistMode(labels, result);
  if (result.status === "unsupported") return result;
  result.config.persist = persist;
  addOptionalSQLPath(result, fileIndex, labels[LABELS.dbInit], "init", "init.sql", false);
  addOptionalSQLPath(result, fileIndex, labels[LABELS.dbSeed], "seed", "seed", true);
  result.hostRequirements.networkAccessRequired = true;
  return result;
}

function normalizeService(rawService) {
  return {
    image: String(rawService.image || ""),
    build: rawService.build,
    command: rawService.command,
    entrypoint: rawService.entrypoint,
    workingDir: String(rawService.working_dir || rawService.workingDir || ""),
    ports: rawService.ports || [],
    expose: rawService.expose || [],
    volumes: rawService.volumes || [],
    environment: rawService.environment || {},
    envFile: rawService.env_file || rawService.envFile || [],
    labels: rawService.labels || {},
  };
}

function baseServiceAnalysis(context, adapterName) {
  return {
    name: context.name,
    image: context.service.image,
    adapter: adapterName,
    browserNative: true,
    status: "ready",
    staticRoot: "",
    assetSource: "",
    publicPort: firstPort(context.service, 0),
    browserPath: "",
    assets: [],
    config: {},
    labels: context.labels,
    hostRequirements: {},
    warnings: [],
    unsupported: [],
    suggestions: [],
    preview: null,
  };
}

function unsupportedResult(context, reason) {
  const result = baseServiceAnalysis(context, ADAPTERS.unsupported);
  reject(result, reason);
  result.suggestions = suggestionsForService(context, result.unsupported);
  return result;
}

function reject(result, reason) {
  result.browserNative = false;
  result.status = "unsupported";
  result.adapter = ADAPTERS.unsupported;
  result.unsupported.push(reason);
}

function needsFiles(result, reason) {
  result.browserNative = false;
  result.status = "needs-files";
  result.unsupported.push(reason);
}

function asset(name, kind, source, target, entries = []) {
  return {
    name,
    kind,
    source,
    target,
    path: `uploaded://${normalizePath(source)}`,
    files: entries.map((entry) => entry.path),
  };
}

function addOptionalFile(result, fileIndex, rawPath, name, target) {
  const path = String(rawPath || "").trim();
  if (!path) return;
  const entry = fileIndex.fileAt(path);
  if (!entry) {
    needsFiles(result, `Upload the project folder containing ${path}.`);
    return;
  }
  result.assets.push(asset(name, "file", path, target, [entry]));
  result.config[`${name}Path`] = `uploaded://${entry.path}`;
}

function addOptionalFilePreserveExt(result, fileIndex, rawPath, name, targetBase) {
  const path = String(rawPath || "").trim();
  if (!path) return;
  const target = extension(path) && !extension(targetBase) ? `${targetBase}${extension(path)}` : targetBase;
  addOptionalFile(result, fileIndex, path, name, target);
}

function addOptionalSQLPath(result, fileIndex, rawPath, name, targetBase, preserveExt) {
  const path = String(rawPath || "").trim();
  if (!path) return;
  const direct = fileIndex.fileAt(path);
  if (direct) {
    if (!validDatabaseAssetFile(path, preserveExt)) {
      reject(result, `${name} file ${path} must be ${databaseAssetFileExpectation(preserveExt)}`);
      return;
    }
    const target = preserveExt && extension(path) && !extension(targetBase)
      ? `${targetBase}${extension(path)}`
      : targetBase;
    result.assets.push(asset(name, "file", path, target, [direct]));
    result.config[`${name}Path`] = `uploaded://${direct.path}`;
    return;
  }

  const files = fileIndex.filesUnder(path);
  if (files.length === 0) {
    needsFiles(result, `Upload the project folder containing ${path}.`);
    return;
  }
  const sqlFiles = files.filter((entry) => isSQLPath(entry.path));
  if (sqlFiles.length === 0) {
    result.warnings.push(`${name} directory ${path} has no .sql files PocketStack can execute.`);
    return;
  }
  if (sqlFiles.length < files.length) {
    result.warnings.push(`${name} directory ${path} includes non-.sql files that are not executed in browser-only mode.`);
  }
  const target = `${name}-scripts`;
  result.assets.push(asset(target, "sql-directory", path, target, sqlFiles));
  appendConfigPaths(result.config, name === "init" ? "initScripts" : "seedScripts", ...sqlFiles.map((entry) => `uploaded://${entry.path}`).sort());
}

function addPostgresInitMounts(result, fileIndex, service) {
  for (const volume of parseVolumes(service.volumes || [])) {
    if (!volume.isBindLike) continue;
    const relative = containerRelativePath(POSTGRES_INIT_TARGET, volume.target);
    if (relative === null) continue;

    const source = volume.source || ".";
    if (!fileIndex.hasUploads) {
      needsFiles(result, `Upload the project folder containing ${source}.`);
      return;
    }

    const direct = fileIndex.fileAt(source);
    if (direct) {
      const target = postgresInitFileTarget(source, relative);
      if (!isSQLPath(source) && !isSQLPath(target)) {
        result.warnings.push(`Postgres init file ${source} is not .sql and is not executed in browser-only mode.`);
        continue;
      }
      result.assets.push(asset("init-script", "file", source, joinPath("init-scripts", target), [direct]));
      appendConfigPaths(result.config, "initScripts", `uploaded://${direct.path}`);
      continue;
    }

    const files = fileIndex.filesUnder(source);
    if (files.length === 0) {
      needsFiles(result, `Upload SQL init files under ${source}.`);
      return;
    }
    const sqlFiles = files.filter((entry) => isSQLPath(entry.path));
    if (sqlFiles.length === 0) {
      result.warnings.push(`Postgres init mount ${source} has no .sql files PocketStack can execute.`);
    } else {
      result.assets.push(asset("init-scripts", "sql-directory", source, postgresInitAssetTarget(relative), sqlFiles));
      appendConfigPaths(result.config, "initScripts", ...sqlFiles.map((entry) => `uploaded://${entry.path}`).sort());
    }
    if (sqlFiles.length < files.length) {
      result.warnings.push(`Postgres init mount ${source} includes non-.sql files that are not executed in browser-only mode.`);
    }
  }
}

function postgresInitAssetTarget(relative) {
  if (!relative || relative === ".") return "init-scripts";
  return joinPath("init-scripts", relative);
}

function postgresInitFileTarget(source, relative) {
  if (!relative || relative === ".") return basename(source);
  return relative;
}

function appendConfigPaths(config, key, ...paths) {
  const values = String(config[key] || "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const path of paths) {
    const normalized = String(path || "").trim();
    if (normalized) values.push(normalized);
  }
  config[key] = values.join("\n");
}

function labelMap(rawLabels) {
  const labels = {};
  if (Array.isArray(rawLabels)) {
    for (const item of rawLabels) {
      const text = String(item);
      const index = text.indexOf("=");
      if (index === -1) labels[text] = "true";
      else labels[text.slice(0, index)] = text.slice(index + 1);
    }
    return labels;
  }
  if (rawLabels && typeof rawLabels === "object") {
    for (const [key, value] of Object.entries(rawLabels)) {
      labels[key] = String(value);
    }
  }
  return labels;
}

function environmentList(rawEnvironment) {
  if (Array.isArray(rawEnvironment)) return rawEnvironment.map(String).sort();
  if (rawEnvironment && typeof rawEnvironment === "object") {
    return Object.entries(rawEnvironment)
      .map(([key, value]) => `${key}=${value}`)
      .sort();
  }
  return [];
}

function envFileEntries(rawEnvFile) {
  if (typeof rawEnvFile === "string") return compactEnvFileEntries([{ path: rawEnvFile, required: true }]);
  if (Array.isArray(rawEnvFile)) {
    return compactEnvFileEntries(
      rawEnvFile.map((item) => {
        if (typeof item === "string") return { path: item, required: true };
        if (item && typeof item === "object") {
          return { path: item.path || "", required: boolDefault(item.required, true) };
        }
        return { path: String(item || ""), required: true };
      }),
    );
  }
  if (rawEnvFile && typeof rawEnvFile === "object") {
    return compactEnvFileEntries([
      { path: rawEnvFile.path || "", required: boolDefault(rawEnvFile.required, true) },
    ]);
  }
  return [];
}

async function serviceEnvironmentList(service, fileIndex, result) {
  const values = new Map();
  let usedEnvFile = false;
  for (const envFile of envFileEntries(service.envFile)) {
    const envPath = envFile.path;
    const entry = fileIndex.fileAt(envPath);
    if (!entry) {
      if (envFile.required) {
        needsFiles(result, `Upload the project folder containing ${envPath}.`);
        return [];
      }
      result.warnings.push(`optional env_file ${envPath} does not exist and was skipped`);
      continue;
    }
    usedEnvFile = true;
    mergeEnvironment(values, parseEnvFile(await entry.file.text(), envPath, result));
  }
  mergeEnvironment(values, environmentList(service.environment));
  if (usedEnvFile) result.warnings.push(ENV_FILE_WARNING);
  return sortedEnvironment(values);
}

function parseEnvFile(raw, envPath, result) {
  const entries = [];
  for (const [index, rawLine] of String(raw).split("\n").entries()) {
    let line = rawLine.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      const key = line.trim();
      if (!key) continue;
      result.warnings.push(
        `env_file ${envPath} line ${index + 1} has no value; PocketStack will set it to an empty string instead of reading host environment.`,
      );
      entries.push(`${key}=`);
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    if (!key) continue;
    entries.push(`${key}=${trimEnvValue(line.slice(equalsIndex + 1))}`);
  }
  return entries;
}

function trimEnvValue(value) {
  const trimmed = String(value).trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function mergeEnvironment(values, entries) {
  for (const entry of entries) {
    const [key, ...rest] = String(entry).split("=");
    const name = key.trim();
    if (!name) continue;
    values.set(name, rest.length === 0 ? "" : rest.join("=").trim());
  }
}

function sortedEnvironment(values) {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);
}

function boolDefault(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function compactEnvFileEntries(values) {
  return values
    .map((value) => ({
      path: String(value.path || "").trim(),
      required: value.required !== false,
    }))
    .filter((value) => value.path);
}

function parseVolumes(rawVolumes) {
  return rawVolumes.map((item) => {
    if (typeof item === "string") {
      const parsed = parseVolumeString(item);
      return { ...parsed, isBindLike: isBindSource(parsed.source) };
    }
    const parsed = {
      raw: "",
      type: String(item.type || ""),
      source: String(item.source || item.src || ""),
      target: String(item.target || item.dst || item.destination || ""),
      readOnly: Boolean(item.read_only || item.readOnly),
    };
    return { ...parsed, isBindLike: parsed.type === "bind" || isBindSource(parsed.source) };
  });
}

function parseVolumeString(raw) {
  const parts = raw.split(":");
  const result = { raw, type: "", source: "", target: "", readOnly: false };
  if (parts.length === 1) {
    result.target = parts[0];
  } else if (parts.length === 2) {
    result.source = parts[0];
    result.target = parts[1];
  } else {
    result.source = parts.slice(0, -2).join(":");
    result.target = parts[parts.length - 2];
    result.readOnly = parts[parts.length - 1].includes("ro");
  }
  if (isBindSource(result.source)) result.type = "bind";
  else if (result.source) result.type = "volume";
  return result;
}

function parsePorts(rawPorts) {
  return rawPorts
    .map((item) => {
      if (typeof item === "number") return { target: item, protocol: "tcp" };
      if (typeof item === "string") {
        const [portPart, protocol = "tcp"] = item.split("/");
        const segments = portPart.split(":");
        const target = Number.parseInt(segments[segments.length - 1], 10);
        return Number.isFinite(target) ? { target, protocol } : null;
      }
      if (item && typeof item === "object") {
        const target = Number.parseInt(item.target, 10);
        return Number.isFinite(target)
          ? { target, published: item.published, protocol: item.protocol || "tcp" }
          : null;
      }
      return null;
    })
    .filter(Boolean);
}

function firstPort(service, fallback) {
  const ports = parsePorts(service.ports || []);
  if (ports.length > 0 && ports[0].target) return ports[0].target;
  const exposed = parsePorts(service.expose || []);
  if (exposed.length > 0 && exposed[0].target) return exposed[0].target;
  return fallback;
}

function frontendSource(service, fileIndex, filename) {
  return (
    bindSourceForWorkingDir(service, fileIndex, filename) ||
    firstBindWithFile(service, fileIndex, filename)
  );
}

function bindSourceForWorkingDir(service, fileIndex, filename) {
  if (!String(service.workingDir || "").trim()) return "";
  const workingDir = cleanAbsolutePath(service.workingDir);
  for (const volume of parseVolumes(service.volumes)) {
    if (!volume.isBindLike) continue;
    const relative = containerRelativePath(volume.target, workingDir);
    if (relative === null) continue;
    const source = joinPath(volume.source || ".", relative);
    if (fileIndex.fileAt(joinPath(source, filename))) return source;
  }
  return "";
}

function firstBindWithFile(service, fileIndex, filename) {
  for (const volume of parseVolumes(service.volumes)) {
    if (!volume.isBindLike) continue;
    if (fileIndex.fileAt(joinPath(volume.source || ".", filename))) {
      return volume.source || ".";
    }
  }
  if (fileIndex.fileAt(filename)) return ".";
  return "";
}

function containerRelativePath(base, target) {
  if (!String(base || "").trim() || !String(target || "").trim()) return null;
  base = cleanAbsolutePath(base);
  target = cleanAbsolutePath(target);
  if (target === base) return ".";
  const prefix = base === "/" ? "/" : `${base}/`;
  if (target.startsWith(prefix)) return target.slice(prefix.length) || ".";
  return null;
}

function createFileIndex(files) {
  const entries = files.map((file) => ({
    file,
    path: normalizePath(file.pocketstackPath || file.webkitRelativePath || file.name),
  }));
  const roots = new Set();
  for (const entry of entries) {
    const [root] = entry.path.split("/");
    if (root && entry.path.includes("/")) roots.add(root);
  }

  function candidatePaths(path) {
    const normalized = normalizePath(path);
    const candidates = new Set([normalized]);
    if (normalized !== ".") {
      for (const root of roots) candidates.add(joinPath(root, normalized));
    }
    return [...candidates].map((item) => item.toLowerCase());
  }

  function filesUnder(path) {
    const normalized = normalizePath(path);
    if (normalized === ".") return entries;
    const candidates = candidatePaths(normalized);
    return entries.filter((entry) => {
      const lower = entry.path.toLowerCase();
      return candidates.some((candidate) => lower === candidate || lower.startsWith(`${candidate}/`));
    });
  }

  function fileAt(path) {
    const candidates = candidatePaths(path);
    return entries.find((entry) => candidates.includes(entry.path.toLowerCase())) || null;
  }

  return {
    entries,
    hasUploads: entries.length > 0,
    filesUnder,
    fileAt,
  };
}

function normalizePath(path) {
  let normalized = String(path || ".")
    .replaceAll("\\", "/")
    .trim()
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized === "") return ".";
  return normalized;
}

function joinPath(...parts) {
  return normalizePath(parts.filter(Boolean).join("/"));
}

function extension(path) {
  const match = String(path).match(/(\.[^.\/]+)$/);
  return match ? match[1] : "";
}

function basename(path) {
  return normalizePath(path).split("/").pop() || "";
}

function isSQLPath(path) {
  return extension(path).toLowerCase() === ".sql";
}

function isJSONPath(path) {
  return extension(path).toLowerCase() === ".json";
}

function isOpenAPIPath(path) {
  return [".yaml", ".yml", ".json"].includes(extension(path).toLowerCase());
}

function isSQLiteDatabasePath(path) {
  return [".db", ".sqlite", ".sqlite3"].includes(extension(path).toLowerCase());
}

function validDatabaseAssetFile(path, allowSQLiteDatabase) {
  return isSQLPath(path) || (allowSQLiteDatabase && isSQLiteDatabasePath(path));
}

function databaseAssetFileExpectation(allowSQLiteDatabase) {
  return allowSQLiteDatabase ? ".sql, .db, .sqlite, or .sqlite3" : ".sql";
}

function isBindSource(source) {
  return (
    source === "." ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("/") ||
    source.startsWith("~/")
  );
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function normalizedImage(image) {
  let normalized = String(image || "").trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (atIndex !== -1) normalized = normalized.slice(0, atIndex);
  const lastSlash = normalized.lastIndexOf("/");
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon > lastSlash) normalized = normalized.slice(0, lastColon);
  return normalized;
}

function isStaticWebImage(image) {
  return ["nginx", "nginxinc/nginx-unprivileged", "httpd", "caddy"].includes(
    normalizedImage(image),
  );
}

function isFrontendImage(image) {
  const normalized = normalizedImage(image);
  return (
    normalized === "node" ||
    isBunImage(image) ||
    normalized.endsWith("/node") ||
    normalized.endsWith("/bun")
  );
}

function isBunImage(image) {
  const normalized = normalizedImage(image);
  return normalized === "bun" || normalized === "oven/bun";
}

function staticTargetsForImage(image) {
  switch (normalizedImage(image)) {
    case "httpd":
      return ["/usr/local/apache2/htdocs", "/var/www/html"];
    case "caddy":
      return ["/srv", "/usr/share/caddy"];
    default:
      return ["/usr/share/nginx/html", "/var/www/html"];
  }
}

function configTargetsForImage(image) {
  switch (normalizedImage(image)) {
    case "httpd":
      return ["/usr/local/apache2/conf", "/usr/local/apache2/conf/httpd.conf", "/etc/apache2", "/etc/httpd"];
    case "caddy":
      return ["/etc/caddy", "/etc/caddy/Caddyfile", "/config/caddy"];
    default:
      return ["/etc/nginx", "/etc/nginx/nginx.conf", "/etc/nginx/conf.d", "/etc/nginx/templates"];
  }
}

function matchesStaticConfigTarget(targets, target) {
  const normalized = cleanAbsolutePath(target);
  return targets.some((current) => {
    const candidate = cleanAbsolutePath(current);
    return normalized === candidate || normalized.startsWith(`${candidate}/`);
  });
}

function cleanAbsolutePath(path) {
  return String(path || "").replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}

function defaultPortForImage(image) {
  switch (normalizedImage(image)) {
    case "caddy":
    case "httpd":
    case "nginx":
    case "nginxinc/nginx-unprivileged":
      return 80;
    default:
      return 0;
  }
}

function labelDefault(labels, key, fallback) {
  const value = String(labels[key] || "").trim();
  return value || fallback;
}

function dbPersistMode(labels, result) {
  const value = String(labels[LABELS.dbPersist] || "").trim();
  if (!value) return "indexeddb";
  if (value === "indexeddb" || value === "memory") return value;
  reject(result, `pocketstack.db.persist must be indexeddb or memory, got "${value}"`);
  return "";
}

function labelInt(labels, key, fallback) {
  const value = Number.parseInt(String(labels[key] || "").trim(), 10);
  return Number.isFinite(value) ? value : fallback;
}

function detectPackageManager(fileIndex, source, image, declared) {
  const declaredManager = normalizePackageManager(declared);
  if (declaredManager) return declaredManager;
  if (fileIndex.fileAt(joinPath(source, "bun.lockb")) || fileIndex.fileAt(joinPath(source, "bun.lock"))) {
    return "bun";
  }
  if (fileIndex.fileAt(joinPath(source, "pnpm-lock.yaml"))) return "pnpm";
  if (fileIndex.fileAt(joinPath(source, "yarn.lock"))) return "yarn";
  if (fileIndex.fileAt(joinPath(source, "package-lock.json")) || fileIndex.fileAt(joinPath(source, "npm-shrinkwrap.json"))) {
    return "npm";
  }
  if (isBunImage(image)) return "bun";
  return "npm";
}

function normalizePackageManager(raw) {
  const name = String(raw || "").trim().toLowerCase().split("@")[0];
  return ["npm", "pnpm", "yarn", "bun"].includes(name) ? name : "";
}

function defaultInstallCommand(fileIndex, source, manager) {
  if (manager === "bun") return "bun install";
  if (manager === "pnpm") return "pnpm install";
  if (manager === "yarn") return "yarn install";
  return fileIndex.fileAt(joinPath(source, "package-lock.json")) ? "npm ci" : "npm install";
}

function frontendCommandInstallsDependencies(command) {
  const normalized = String(command || "").toLowerCase().trim().replace(/\s+/g, " ");
  return [
    "npm install",
    "npm i",
    "npm ci",
    "pnpm install",
    "pnpm i",
    "yarn install",
    "bun install",
    "bun i",
  ].some((current) => commandContainsShellWordSequence(normalized, current));
}

function commandContainsShellWordSequence(command, sequence) {
  let index = command.indexOf(sequence);
  while (index >= 0) {
    const before = index === 0 ? "" : command[index - 1];
    const after = command[index + sequence.length] || "";
    const beforeOK = before === "" || /[\s;&|()"']/.test(before);
    const afterOK = after === "" || /[\s;&|()"']/.test(after);
    if (beforeOK && afterOK) return true;
    index = command.indexOf(sequence, index + 1);
  }
  return false;
}

function defaultRunCommand(manager, script) {
  if (script === "start") {
    if (manager === "bun") return "bun run start -- --host 0.0.0.0";
    if (manager === "pnpm") return "pnpm start -- --host 0.0.0.0";
    if (manager === "yarn") return "yarn run start -- --host 0.0.0.0";
    return "npm start -- --host 0.0.0.0";
  }
  if (manager === "bun") return `bun run ${script} -- --host 0.0.0.0`;
  if (manager === "pnpm") return `pnpm run ${script} -- --host 0.0.0.0`;
  if (manager === "yarn") return `yarn run ${script} -- --host 0.0.0.0`;
  return `npm run ${script} -- --host 0.0.0.0`;
}

function composeCommandString(command) {
  if (typeof command === "string") return command.trim();
  if (Array.isArray(command)) return joinCommandParts(command.map(String));
  return "";
}

function composeEntrypointCommandString(entrypoint, command) {
  const entrypointText = composeCommandString(entrypoint);
  let commandText = composeCommandString(command);
  if (!entrypointText) return commandText;
  if (!commandText) return entrypointText;
  if (Array.isArray(entrypoint) && typeof command === "string") {
    commandText = quoteCommandPart(command.trim());
  }
  return `${entrypointText} ${commandText}`.trim();
}

function joinCommandParts(parts) {
  return parts
    .map((part) => quoteCommandPart(String(part).trim()))
    .filter(Boolean)
    .join(" ");
}

function quoteCommandPart(part) {
  if (!/[\s"']/.test(part)) return part;
  if (!part.includes('"')) return `"${part}"`;
  if (!part.includes("'")) return `'${part}'`;
  return part.replaceAll(" ", "\\ ");
}

function mergeHostRequirements(left = {}, right = {}) {
  const headers = { ...(left.headers || {}), ...(right.headers || {}) };
  return {
    crossOriginIsolationRequired:
      Boolean(left.crossOriginIsolationRequired) || Boolean(right.crossOriginIsolationRequired),
    networkAccessRequired:
      Boolean(left.networkAccessRequired) || Boolean(right.networkAccessRequired),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function compactReasons(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort();
}

function primaryUnsupportedReasons(context, rejected) {
  const { service } = context;
  const image = normalizedImage(service.image);
  let reasons = [];
  if (hasValue(service.build)) {
    reasons.push("Docker build contexts cannot run in a browser-native demo");
  }
  if (knownStatefulImage(image)) {
    reasons.push(`image "${service.image}" is a stateful service without a direct browser-native container adapter`);
  }
  if (isStaticWebImage(service.image)) {
    reasons = appendMatchingReasons(reasons, rejected, "static");
  } else if (isFrontendImage(service.image)) {
    reasons = appendMatchingReasons(reasons, rejected, "frontend", "package.json", "env_file");
  } else if (image === "postgres") {
    reasons = appendMatchingReasons(reasons, rejected, "postgres", "pocketstack.db");
  }
  if (reasons.length === 0) {
    reasons.push(service.image
      ? `image "${service.image}" does not map to a browser-native adapter`
      : "service does not declare a supported browser-native adapter");
  }
  return compactReasons(reasons);
}

function appendMatchingReasons(values, rejected, ...needles) {
  for (const reason of rejected) {
    const lower = String(reason).toLowerCase();
    if (needles.some((needle) => lower.includes(String(needle).toLowerCase()))) {
      values.push(reason);
    }
  }
  return values;
}

function browserReadiness(services) {
  const total = services.length;
  const native = services.filter((service) => service.browserNative).length;
  const score = total > 0 ? Math.floor((native * 100) / total) : 0;
  let status = "blocked";
  if (total > 0 && native === total) status = "ready";
  else if (native > 0) status = "partial";
  return {
    status,
    browserNativeServices: native,
    totalServices: total,
    score,
    summary: status === "ready" ? "all services are browser-native" : `${native} of ${total} services are browser-native`,
  };
}

function projectNextSteps(services) {
  const steps = [];
  let allNative = true;
  for (const service of services) {
    if (service.browserNative) continue;
    allNative = false;
    for (const suggestion of service.suggestions || []) {
      appendUnique(steps, `${service.name}: ${suggestion}`);
    }
  }
  if (allNative) return ["Run `pocketstack demo` to generate a static browser-native demo."];
  if (steps.length === 0) {
    steps.push("Replace unsupported services with static assets, frontend projects, WASI modules, browser databases, or OpenAPI mocks.");
  }
  return steps;
}

function suggestionsForService(context, reasons = []) {
  const { service, explicit } = context;
  const image = normalizedImage(service.image);
  const suggestions = [];
  if (explicit && !SUPPORTED_EXPLICIT.has(explicit)) {
    appendUnique(suggestions, "Use a supported explicit adapter: frontend, wasi, mock-http, postgres-pglite, or sqlite.");
  }
  if (hasValue(service.build)) {
    appendUnique(suggestions, "Run the Docker build before PocketStack and expose the browser-ready output as static files, frontend source, WASI, fixtures, or SQL seed data.");
  }
  for (const reason of reasons) {
    const lower = String(reason).toLowerCase();
    if (lower.includes("static-web is autodetected")) {
      appendUnique(suggestions, "Remove `pocketstack.adapter=static-web`; use an nginx, httpd, or caddy image with a document-root bind mount.");
    } else if (lower.includes("no local static asset") && isStaticWebImage(service.image)) {
      appendUnique(suggestions, "Upload a project folder with local static files mounted at the image document root.");
    } else if (lower.includes("package.json") && (explicit === ADAPTERS.frontend || isFrontendImage(service.image))) {
      appendUnique(suggestions, "Upload or mount the frontend source directory that contains `package.json`.");
    } else if ((lower.includes("dev/start script") || lower.includes("frontend.start")) && (explicit === ADAPTERS.frontend || isFrontendImage(service.image))) {
      appendUnique(suggestions, "Add a `dev` or `start` package script, or set `pocketstack.frontend.start`.");
    } else if ((lower.includes("openapi") || lower.includes("fixtures")) && explicit === ADAPTERS.mockHTTP) {
      appendUnique(suggestions, "For HTTP APIs, add `pocketstack.adapter=mock-http` with an OpenAPI file and/or JSON fixtures.");
    } else if ((lower.includes(".wasm") || lower.includes("wasi")) && explicit === ADAPTERS.wasi) {
      appendUnique(suggestions, "Compile the service to a prebuilt WASI `.wasm` module and reference it with `pocketstack.wasi.module`.");
    } else if (lower.includes("env_file")) {
      appendUnique(suggestions, "Include required env files in the uploaded project or mark optional env files with `required: false`.");
    }
  }
  if (knownStatefulImage(image)) {
    appendUnique(suggestions, "For demos, replace this stateful service with SQLite, PGlite, fixtures, or in-browser mock state.");
  } else if (image === "postgres") {
    appendUnique(suggestions, "Keep Postgres demo data in `.sql` init/seed files so PocketStack can run it with PGlite.");
  } else if (isStaticWebImage(service.image)) {
    appendUnique(suggestions, "Use only document-root file mounts for browser-native static previews; server rewrites and custom config are not emulated.");
  }
  if ((service.ports || []).length > 0 && !explicit && !knownStatefulImage(image) && !isStaticWebImage(service.image) && !isFrontendImage(service.image) && image !== "postgres") {
    appendUnique(suggestions, "If this is an HTTP service, model the demo surface as `mock-http` instead of trying to run the container.");
  }
  if (suggestions.length === 0) {
    suggestions.push("Choose a browser-native representation: static-web, frontend, WASI, mock-http, postgres-pglite, or sqlite.");
  }
  return suggestions;
}

function appendUnique(values, value) {
  value = String(value || "").trim();
  if (value && !values.includes(value)) values.push(value);
  return values;
}

function knownStatefulImage(image) {
  return ["mysql", "mariadb", "mongo", "mongodb", "redis", "valkey", "memcached"].includes(image);
}

async function demoStorageNamespace(composeName, fileIndex) {
  const input = [
    composeName || "compose.yaml",
    ...fileIndex.entries.map((entry) => entry.path).sort(),
  ].join("\n");
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return `ps-${[...new Uint8Array(hash)]
      .slice(0, 8)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return `ps-${fallbackHash(input)}`;
}

function fallbackHash(input) {
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(2).slice(0, 16);
}

function toManifestService(service, storageNamespace) {
  const config = { ...service.config };
  if (isDatabaseAdapter(service.adapter)) config.storageNamespace = storageNamespace;
  return {
    name: service.name,
    image: service.image,
    adapter: service.adapter,
    browserNative: service.browserNative,
    status: service.status,
    publicPort: service.publicPort,
    browserPath: service.browserPath,
    assets: service.assets.map(({ name, kind, path, files, target }) => ({
      name,
      kind,
      path,
      files,
      target,
    })),
    config,
    warnings: service.warnings,
    unsupported: service.unsupported,
    suggestions: service.suggestions,
    hostRequirements: service.hostRequirements,
  };
}

function isDatabaseAdapter(adapter) {
  return adapter === ADAPTERS.postgres || adapter === ADAPTERS.sqlite;
}

function usesFrontendBridge(services) {
  const hasFrontend = services.some((service) => service.adapter === ADAPTERS.frontend && service.browserNative);
  const hasBridgeTarget = services.some((service) => (
    service.browserNative
    && (service.adapter === ADAPTERS.mockHTTP || isDatabaseAdapter(service.adapter))
  ));
  return hasFrontend && hasBridgeTarget;
}

async function renderAnalysis(analysis, fileIndex) {
  const ready = analysis.services.filter((service) => service.status === "ready").length;
  const needsFiles = analysis.services.filter((service) => service.status === "needs-files").length;

  els.modeValue.textContent = analysis.mode;
  els.readinessScore.textContent = `${analysis.readiness.score}%`;
  els.serviceCount.textContent = String(analysis.services.length);
  els.readyCount.textContent = String(ready);
  els.needsCount.textContent = String(needsFiles);
  els.downloadButton.disabled = false;
  els.manifestOutput.textContent = JSON.stringify(analysis.manifest, null, 2);

  if (analysis.warnings.length > 0) showNotice(analysis.warnings.join(" "));
  else showNotice("");

  els.serviceList.replaceChildren(...analysis.services.map(renderServiceCard));
  await renderPreview(analysis, fileIndex);
}

function renderServiceCard(service) {
  const card = document.createElement("article");
  card.className = "service-card";

  const messages = [
    ...service.warnings.map((message) => ({ message, kind: "warn" })),
    ...service.unsupported.map((message) => ({
      message,
      kind: service.status === "needs-files" ? "warn" : "blocked",
    })),
    ...(service.suggestions || []).map((message) => ({ message, kind: "suggest" })),
  ];

  card.innerHTML = `
    <div class="service-top">
      <div class="service-title">
        <strong></strong>
        <span></span>
      </div>
      <span class="badge ${service.status}">${statusLabel(service.status)}</span>
    </div>
    <div class="adapter-row">
      <span class="adapter-tag"></span>
      ${service.publicPort ? `<span class="port-tag">port ${service.publicPort}</span>` : ""}
    </div>
  `;

  card.querySelector("strong").textContent = service.name;
  card.querySelector(".service-title span").textContent = service.image || "no image";
  card.querySelector(".adapter-tag").textContent = service.adapter;

  if (messages.length > 0) {
    const list = document.createElement("ul");
    list.className = "message-list";
    for (const item of messages) {
      const li = document.createElement("li");
      li.className = item.kind;
      li.textContent = item.message;
      list.append(li);
    }
    card.append(list);
  }

  return card;
}

async function renderPreview(analysis, fileIndex) {
  const staticService = analysis.services.find((service) => service.preview?.type === "static");
  els.previewPanel.replaceChildren();
  if (!staticService) {
    els.previewLabel.textContent = "static services only";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No static preview available.";
    els.previewPanel.append(empty);
    return;
  }

  const entry = fileIndex.fileAt(staticService.preview.indexPath);
  if (!entry) return;
  const iframe = document.createElement("iframe");
  iframe.title = `${staticService.name} preview`;
  // Uploaded HTML is untrusted; isolate it in an opaque origin so it cannot
  // touch the Studio page, its storage, or its parent DOM.
  iframe.sandbox = "allow-scripts";
  iframe.srcdoc = await entry.file.text();
  els.previewLabel.textContent = staticService.name;
  els.previewPanel.append(iframe);
}

function renderError(error) {
  els.modeValue.textContent = "error";
  els.readinessScore.textContent = "0%";
  els.serviceCount.textContent = "0";
  els.readyCount.textContent = "0";
  els.needsCount.textContent = "0";
  els.downloadButton.disabled = true;
  els.manifestOutput.textContent = "{}";
  els.serviceList.innerHTML = `<div class="empty-state"></div>`;
  els.serviceList.querySelector(".empty-state").textContent = error.message;
  els.previewPanel.innerHTML = `<div class="empty-state">Fix the Compose file, then analyze again.</div>`;
  showNotice(error.message);
}

function renderEmptyState() {
  els.modeValue.textContent = "waiting";
  els.readinessScore.textContent = "0%";
  els.serviceCount.textContent = "0";
  els.readyCount.textContent = "0";
  els.needsCount.textContent = "0";
  els.downloadButton.disabled = true;
  els.manifestOutput.textContent = "{}";
  els.serviceList.innerHTML = `<div class="empty-state">No project loaded.</div>`;
  els.previewPanel.innerHTML = `<div class="empty-state">No static preview available.</div>`;
  els.previewLabel.textContent = "static services only";
}

function statusLabel(status) {
  if (status === "ready") return "ready";
  if (status === "needs-files") return "needs files";
  return "unsupported";
}

function folderLabel(count) {
  if (count === 0) return "optional, no files selected";
  if (count === 1) return "1 file selected";
  return `${count} files selected`;
}

function showNotice(message) {
  els.notice.hidden = !message;
  els.notice.textContent = message;
}

updateComposeMeta();
