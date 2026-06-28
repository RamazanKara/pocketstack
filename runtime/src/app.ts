import { databaseSQLAssetPaths, sqliteSQLAssetPaths } from "./db-assets";
import { createWebContainerTree, frontendBridgeOptions, frontendDisplayCommand, frontendEnvironment, isTextProjectFile, splitCommand } from "./frontend-adapter";
import { mergeMockRoutes, normalizeFixtureRoute, routesFromOpenAPIDocument } from "./mock-routes";
import { deletePGliteStorage, ensurePGliteBootstrapped, pgliteDataDir } from "./pglite-adapter";
import { databaseServices, frontendServiceEnvironment } from "./service-urls";
import { isSQLiteDatabasePath, sqlitePersists, sqliteStorageKey } from "./sqlite-adapter";
import { WASIExit, createWASIImportObject, createWASIPreviewImports, normalizeEnvironmentRecord, wasmerRunOptions } from "./wasi-preview";
import { load as loadYAML } from "js-yaml";

const state = {
  manifest: null,
  selected: null,
  webcontainers: new Map(),
  frontendProcesses: new Map(),
  databases: new Map(),
  databaseHandles: new Map(),
  runtimeWorkerRegistration: null,
  mockRoutes: new Map(),
  databaseBridgeListening: false,
  frontendBridgeListening: false,
};

const $ = (selector) => document.querySelector(selector);
const logBox = () => $("#logs");

function log(message, tone = "") {
  const prefix = tone ? `[${tone}] ` : "";
  logBox().textContent += `${prefix}${message}\n`;
  logBox().scrollTop = logBox().scrollHeight;
}

function setStatus(message, tone = "") {
  const status = $("#status");
  status.textContent = message;
  status.className = tone;
}

function setDetails(message) {
  $("#details").textContent = message;
}

// Browser runtime packages are loaded from public CDNs at demo time. Pinning
// the versions keeps previously generated demos working when an upstream
// package ships a breaking new major. See docs/HOSTING.md for the offline /
// vendoring story.
const CDN = {
  webcontainer: "https://esm.sh/@webcontainer/api@1",
  pglite: "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2/dist/index.js",
  wasmer: "https://unpkg.com/@wasmer/sdk@0.10.0/dist/index.mjs",
  sqlJsBase: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3",
};

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Compose service names, OpenAPI route paths, and fixture data are all
// untrusted input. Escape them before interpolating into innerHTML.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

async function importModule(url, label) {
  try {
    return await import(url);
  } catch (error) {
    throw new Error(`Could not load ${label} from ${url}. This demo needs network access to that CDN and cannot run offline. (${error?.message || error})`);
  }
}

function asset(service, name) {
  return (service.assets || []).find((item) => item.name === name);
}

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.text();
}

async function fetchBytes(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.arrayBuffer();
}

async function loadManifest() {
  const response = await fetch("./pocketstack.manifest.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load pocketstack.manifest.json");
  return response.json();
}

function selectService(service) {
  state.selected = service;
  document.querySelectorAll("[data-service]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.service === service.name ? "true" : "false");
  });
  logBox().textContent = "";
  setStatus(`${service.name}: ${service.adapter}`);
  setDetails(serviceDetails(service));
  renderPreview(service);
  logServiceWarnings(service);
}

function serviceDetails(service) {
  const parts = [service.image || service.adapter];
  const warningCount = (service.warnings || []).length;
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  if (service.hostRequirements?.crossOriginIsolationRequired) parts.push("COOP/COEP required");
  if (service.hostRequirements?.networkAccessRequired) parts.push("network required");
  return parts.filter(Boolean).join(" · ");
}

function logServiceWarnings(service) {
  for (const warning of service.warnings || []) {
    log(warning, "warn");
  }
  if (service.hostRequirements?.crossOriginIsolationRequired) {
    log("This service requires cross-origin isolation headers.", "warn");
  }
  if (service.hostRequirements?.networkAccessRequired) {
    log("This service may load public browser runtime packages or npm dependencies.", "warn");
  }
}

function renderPreview(service) {
  const preview = $("#preview");
  preview.innerHTML = "";
  if (service.adapter === "static-web" && service.browserPath) {
    const frame = document.createElement("iframe");
    frame.title = `${service.name} preview`;
    frame.src = service.browserPath;
    preview.append(frame);
    log("Static preview loaded.");
    return;
  }
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = `<h2>${escapeHTML(service.name)}</h2><p>${descriptionFor(service)}</p>`;
  preview.append(panel);
}

function descriptionFor(service) {
  switch (service.adapter) {
    case "frontend":
      return "Start this service to install dependencies and run it in a browser WebContainer.";
    case "wasi":
      return "Start this service to execute the prebuilt WebAssembly module in the browser.";
    case "mock-http":
      return `Mock routes are served under <code>${mockRouteURL(service, "/")}</code>.`;
    case "postgres-pglite":
      return "Start this service to initialize a PGlite Postgres-compatible database in the browser.";
    case "sqlite":
      return "Start this service to initialize SQLite in the browser.";
    default:
      return "Browser-native PocketStack service.";
  }
}

async function startSelected() {
  if (!state.selected) return;
  const service = state.selected;
  try {
    setStatus(`${service.name}: starting`);
    switch (service.adapter) {
      case "static-web":
        renderPreview(service);
        break;
      case "frontend":
        await startFrontend(service);
        break;
      case "wasi":
        await startWASI(service);
        break;
      case "mock-http":
        await startMock(service);
        break;
      case "postgres-pglite":
        await startPGlite(service);
        break;
      case "sqlite":
        await startSQLite(service);
        break;
      default:
        throw new Error(`Unsupported adapter ${service.adapter}`);
    }
    setStatus(`${service.name}: running`, "ok");
  } catch (error) {
    setStatus(`${service.name}: failed`, "danger");
    log(error.stack || error.message, "error");
  }
}

async function resetSelected() {
  if (!state.selected) return;
  const service = state.selected;
  await stopFrontend(service);
  state.databases.delete(service.name);
  await closeDatabaseHandle(service);
  if (service.adapter === "sqlite") {
    await deleteSQLiteSnapshot(service);
  }
  if (service.adapter === "postgres-pglite") {
    if (await deletePGliteStorage(service)) {
      log("Deleted PGlite IndexedDB database.");
    }
  }
  logBox().textContent = "";
  renderPreview(service);
  setStatus(`${service.name}: reset`);
}

async function startFrontend(service) {
  if (!crossOriginIsolated) {
    throw new Error("This frontend demo needs cross-origin isolation. Serve it with COOP/COEP headers (PocketStack writes _headers / vercel.json / staticwebapp.config.json next to the demo). See docs/HOSTING.md.");
  }
  await ensureRuntimeServicesRegistered();
  const project = asset(service, "project");
  if (!project) throw new Error("frontend project asset missing");
  const { WebContainer } = await importModule(CDN.webcontainer, "the WebContainer runtime");
  let container = state.webcontainers.get(service.name);
  if (!container) {
    container = await WebContainer.boot();
    state.webcontainers.set(service.name, container);
    container.on("server-ready", (_port, url) => {
      const frame = document.createElement("iframe");
      frame.title = `${service.name} frontend`;
      frame.src = url;
      $("#preview").replaceChildren(frame);
      log(`Frontend server ready at ${url}`);
    });
    await container.mount(await createWebContainerTree(
      project,
      (file) => readFrontendProjectFile(project, file),
      frontendBridgeOptions(state.manifest?.services || []),
    ));
  }
  if (state.frontendProcesses.has(service.name)) {
    log("Frontend dev server is already running.");
    return;
  }
  const env = frontendServiceEnvironment(
    frontendEnvironment(service.config.env || {}),
    state.manifest?.services || [],
    window.location.href,
  );
  const install = service.config.install ?? "npm install";
  if (frontendDisplayCommand(install)) {
    await runContainerCommand(container, install, { env });
  } else {
    log("Skipping separate install because the start command handles dependencies.");
  }
  const process = await spawnContainerCommand(container, service.config.start || "npm run dev -- --host 0.0.0.0", { env });
  state.frontendProcesses.set(service.name, process);
  process.exit.then((code) => {
    state.frontendProcesses.delete(service.name);
    log(`Frontend process exited with code ${code}.`, code === 0 ? "" : "warn");
  }).catch((error) => log(error.message, "frontend"));
}

async function readFrontendProjectFile(project, file) {
  const path = `${project.path}/${file}`;
  if (isTextProjectFile(file)) return fetchText(path);
  return new Uint8Array(await fetchBytes(path));
}

async function runContainerCommand(container, command, options = {}) {
  const process = await spawnContainerCommand(container, command, options);
  if (!process) return 0;
  const code = await process.exit;
  if (code !== 0) throw new Error(`${frontendDisplayCommand(command)} exited with code ${code}`);
  return code;
}

async function spawnContainerCommand(container, command, options = {}) {
  const [bin, ...args] = splitCommand(command);
  if (!bin) return;
  log(`$ ${frontendDisplayCommand(command)}`);
  const process = await container.spawn(bin, args, options);
  process.output.pipeTo(new WritableStream({
    write(data) {
      log(String(data).replace(/\n$/, ""));
    },
  })).catch((error) => log(error.message, "frontend"));
  return process;
}

async function stopFrontend(service) {
  const process = state.frontendProcesses.get(service.name);
  state.frontendProcesses.delete(service.name);
  if (typeof process?.kill === "function") process.kill();
  const container = state.webcontainers.get(service.name);
  state.webcontainers.delete(service.name);
  if (typeof container?.teardown === "function") await container.teardown();
}

async function startWASI(service) {
  const module = service.config.modulePath;
  if (!module) throw new Error("WASI module path missing");
  const bytes = new Uint8Array(await fetchBytes(module));
  const args = splitCommand(service.config.args || "");
  const env = normalizeEnvironmentRecord(service.config.env || {});
  try {
    await runWASIPreview(bytes, service, args, env);
  } catch (error) {
    if (error instanceof WASIExit) {
      log(error.message, "wasi");
      return;
    }
    await runWASIWithWasmer(bytes, service, args, env, error);
  }
}

async function runWASIPreview(bytes, service, args, env) {
  let instance;
  const imports = createWASIPreviewImports({
    service,
    args,
    env,
    getInstance: () => instance,
    log,
  });
  const result = await WebAssembly.instantiate(bytes, createWASIImportObject(imports));
  const instantiated = result.instance || result;
  instance = instantiated;
  const exports = instantiated.exports;
  try {
    if (typeof exports._start === "function") exports._start();
    else if (typeof exports._initialize === "function") exports._initialize();
    else log("WASM module has no _start or _initialize export.", "warn");
    if (typeof imports.__pocketstack_flush === "function") imports.__pocketstack_flush();
  } catch (error) {
    if (!(error instanceof WASIExit)) throw error;
    log(error.message, "wasi");
  }
  log("WASM module instantiated in the browser.");
}

async function runWASIWithWasmer(bytes, service, args, env, originalError) {
  log(`Built-in WASI preview failed: ${originalError.message}`, "warn");
  if (!crossOriginIsolated) {
    log("Wasmer JS fallback requires COOP/COEP headers for cross-origin isolation.", "warn");
  }
  const wasmer = await importModule(CDN.wasmer, "the Wasmer JS fallback");
  if (typeof wasmer.init === "function") await wasmer.init();
  if (typeof wasmer.runWasix !== "function") {
    throw new Error(`The Wasmer JS fallback did not expose runWasix; the WASI module could not run. (original preview error: ${originalError.message})`);
  }
  const instance = await wasmer.runWasix(bytes, wasmerRunOptions(service, args, env));
  const output = await instance.wait();
  logMultilineOutput(output.stdout, "");
  logMultilineOutput(output.stderr, "stderr");
  if (!output.ok) {
    throw new Error(`Wasmer JS exited with code ${output.code}`);
  }
  log(`Wasmer JS ran the WASI module with exit code ${output.code}.`);
}

function logMultilineOutput(output, tone) {
  for (const line of String(output || "").replace(/\r\n/g, "\n").split("\n")) {
    if (line !== "") log(line, tone);
  }
}

async function startMock(service) {
  await ensureRuntimeServicesRegistered();
  const routes = state.mockRoutes.get(service.name) || [];
  log(`Registered ${routes.length} mock route(s).`);
  renderMockRoutes(service, routes);
}

async function ensureRuntimeServicesRegistered() {
  if (!runtimeWorkerNeeded()) return;
  if (location.protocol === "file:") {
    throw new Error("mock-http and browser-database demos use a service worker, which does not run from file://. Serve the demo over http(s) — e.g. run `npx serve` inside the demo folder. See docs/HOSTING.md.");
  }
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers.");
  }
  installDatabaseBridgeHandler();
  if (!state.runtimeWorkerRegistration) {
    state.runtimeWorkerRegistration = await navigator.serviceWorker.register("./mock-sw.js", { scope: "./" });
  }
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active || navigator.serviceWorker.controller || state.runtimeWorkerRegistration.active;
  if (!worker) throw new Error("PocketStack service worker is not active yet.");
  await registerMockRoutes(worker);
}

function runtimeWorkerNeeded() {
  const services = state.manifest?.services || [];
  return services.some((service) => service.adapter === "mock-http")
    || databaseServices(services).length > 0;
}

async function registerMockRoutes(worker) {
  const services = (state.manifest?.services || []).filter((service) => service.adapter === "mock-http");
  for (const service of services) {
    let routes = state.mockRoutes.get(service.name);
    if (!routes) {
      routes = await loadMockRoutes(service);
      state.mockRoutes.set(service.name, routes);
      log(`Loaded ${routes.length} mock route(s) for ${service.name}.`, "mock");
    }
    worker.postMessage({ type: "POCKETSTACK_ROUTES", service: service.name, routes });
  }
}

function installDatabaseBridgeHandler() {
  if (state.databaseBridgeListening || !("serviceWorker" in navigator)) return;
  state.databaseBridgeListening = true;
  navigator.serviceWorker.addEventListener("message", async (event) => {
    if (!event.data || event.data.type !== "POCKETSTACK_DB_QUERY") return;
    const port = event.ports?.[0];
    if (!port) return;
    try {
      const result = await queryDatabaseService(event.data.service, event.data.sql);
      port.postMessage({ ok: true, result });
    } catch (error) {
      port.postMessage({ ok: false, error: error.message || String(error) });
    }
  });
}

function installFrontendBridgeHandler() {
  if (state.frontendBridgeListening) return;
  state.frontendBridgeListening = true;
  window.addEventListener("message", async (event) => {
    if (!event.data || event.data.type !== "POCKETSTACK_BRIDGE_FETCH") return;
    try {
      const response = await fetchFrontendBridgeTarget(event.data);
      event.source?.postMessage({
        type: "POCKETSTACK_BRIDGE_RESPONSE",
        id: event.data.id,
        ok: true,
        response,
      }, "*");
    } catch (error) {
      event.source?.postMessage({
        type: "POCKETSTACK_BRIDGE_RESPONSE",
        id: event.data.id,
        ok: false,
        error: error.message || String(error),
      }, "*");
    }
  });
}

async function fetchFrontendBridgeTarget(request) {
  const target = frontendBridgeTargetURL(request.url);
  if (!target) throw new Error(`PocketStack bridge cannot proxy ${request.url}`);
  await ensureRuntimeServicesRegistered();
  const method = request.method || "GET";
  const init = {
    method,
    headers: request.headers || [],
  };
  if (method !== "GET" && method !== "HEAD") init.body = request.body || "";
  const response = await fetch(target, init);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body: await response.text(),
  };
}

function frontendBridgeTargetURL(rawURL) {
  let url;
  try {
    url = new URL(rawURL, window.location.href);
  } catch {
    return "";
  }
  const pathTarget = frontendBridgePathTarget(url);
  if (pathTarget) return pathTarget;
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  const service = (state.manifest?.services || []).find((item) => (
    item.name === url.hostname && frontendBridgePortMatches(url, item)
  ));
  if (!service) return "";
  if (service.adapter === "mock-http") {
    return demoURL(`./__pocketstack/mock/${encodeURIComponent(service.name)}${url.pathname}${url.search}${url.hash}`);
  }
  if (service.adapter === "postgres-pglite" || service.adapter === "sqlite") {
    const path = url.pathname === "/" ? "/query" : url.pathname;
    return demoURL(`./__pocketstack/db/${encodeURIComponent(service.name)}${path}${url.search}${url.hash}`);
  }
  return "";
}

function frontendBridgePathTarget(url) {
  for (const marker of ["/__pocketstack/mock/", "/__pocketstack/db/"]) {
    const index = url.pathname.indexOf(marker);
    if (index < 0) continue;
    return demoURL(`.${url.pathname.slice(index)}${url.search}${url.hash}`);
  }
  return "";
}

function frontendBridgePortMatches(url, service) {
  return !url.port || !service.publicPort || Number(url.port) === Number(service.publicPort);
}

function demoURL(path) {
  return new URL(path, window.location.href).toString();
}

async function queryDatabaseService(name, sql) {
  const service = (state.manifest?.services || []).find((item) => item.name === name);
  if (!service || (service.adapter !== "postgres-pglite" && service.adapter !== "sqlite")) {
    throw new Error(`database service ${name} is not available`);
  }
  const query = service.adapter === "postgres-pglite"
    ? await startPGlite(service, { render: false })
    : await startSQLite(service, { render: false });
  return parseQueryOutput(await query(sql));
}

function parseQueryOutput(output) {
  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

async function loadMockRoutes(service) {
  const [openAPIRoutes, fixtureRoutes] = await Promise.all([
    loadOpenAPIRoutes(service),
    loadFixtureRoutes(service),
  ]);
  return mergeMockRoutes(openAPIRoutes, fixtureRoutes);
}

async function loadOpenAPIRoutes(service) {
  const openAPIPath = service.config.openapiPath;
  if (!openAPIPath) return [];
  const raw = await fetchText(openAPIPath);
  const document = await parseOpenAPI(raw, openAPIPath);
  const routes = routesFromOpenAPIDocument(document);
  log(`Loaded ${routes.length} OpenAPI route(s).`, "mock");
  return routes;
}

async function parseOpenAPI(raw, path) {
  const trimmed = raw.trim();
  if (path.endsWith(".json") || trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  return loadYAML(raw);
}

async function loadFixtureRoutes(service) {
  const fixtures = asset(service, "fixtures");
  const routes = [];
  if (!fixtures) return routes;
  for (const file of fixtures.files || []) {
    if (!file.endsWith(".json")) continue;
    const payload = JSON.parse(await fetchText(`${fixtures.path}/${file}`));
    routes.push(normalizeFixtureRoute({
      ...payload,
      path: payload.path || `/${file.replace(/\.json$/, "")}`,
    }));
  }
  return routes;
}

function renderMockRoutes(service, routes) {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = `<h2>${escapeHTML(service.name)}</h2>${routes.map((route) => {
    const displayPath = routePathWithQuery(route);
    const url = mockRouteURL(service, samplePath(displayPath));
    return `<p><code>${escapeHTML(route.method)} ${escapeHTML(mockRouteURL(service, displayPath))}</code> <button type="button" data-try="${escapeHTML(url)}">Try</button></p>`;
  }).join("")}<pre style="height:auto;min-height:120px"></pre>`;
  const output = panel.querySelector("pre");
  panel.querySelectorAll("[data-try]").forEach((button) => {
    button.addEventListener("click", async () => {
      const response = await fetch(button.dataset.try);
      output.textContent = await response.text();
    });
  });
  $("#preview").replaceChildren(panel);
}

function samplePath(path) {
  return path.replace(/\{[^/]+\}/g, "sample");
}

function routePathWithQuery(route) {
  return `${route.path}${route.query ? `?${route.query}` : ""}`;
}

function mockRouteURL(service, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `./__pocketstack/mock/${encodeURIComponent(service.name)}${normalizedPath}`;
}

async function startPGlite(service, options = {}) {
  const render = options.render !== false;
  if (state.databases.has(service.name)) {
    const query = state.databases.get(service.name);
    if (render) renderQueryPanel(service, query);
    return query;
  }
  const { PGlite } = await importModule(CDN.pglite, "PGlite");
  const db = new PGlite(pgliteDataDir(service));
  const bootstrapped = await ensurePGliteBootstrapped(db, () => executeSQLAssets(db, service), log);
  if (!bootstrapped) log("Loaded persisted PGlite database.");
  log("PGlite database initialized.");
  const query = async (sql) => {
    // Use exec (not query) so multiple semicolon-separated statements run,
    // matching the SQLite adapter's behavior in the same query panel.
    const results = await db.exec(sql);
    return JSON.stringify(results, null, 2);
  };
  state.databases.set(service.name, query);
  state.databaseHandles.set(service.name, db);
  if (render) renderQueryPanel(service, query);
  return query;
}

async function startSQLite(service, options = {}) {
  const render = options.render !== false;
  if (state.databases.has(service.name)) {
    const query = state.databases.get(service.name);
    if (render) renderQueryPanel(service, query);
    return query;
  }
  try {
    await loadScript(`${CDN.sqlJsBase}/sql-wasm.js`);
  } catch {
    throw new Error(`Could not load sql.js from ${CDN.sqlJsBase}. This demo needs network access to that CDN and cannot run offline.`);
  }
  const SQL = await window.initSqlJs({
    locateFile: (file) => `${CDN.sqlJsBase}/${file}`,
  });
  const opened = await openSQLiteDatabase(SQL, service);
  const db = opened.db;
  if (!opened.restored) {
    await executeSQLiteAssets(db, service);
  }
  log("SQLite database initialized.");
  const query = async (sql) => {
    const result = db.exec(sql);
    await saveSQLiteSnapshot(service, db);
    return JSON.stringify(result, null, 2);
  };
  state.databases.set(service.name, query);
  state.databaseHandles.set(service.name, db);
  if (render) renderQueryPanel(service, query);
  return query;
}

async function closeDatabaseHandle(service) {
  const handle = state.databaseHandles.get(service.name);
  state.databaseHandles.delete(service.name);
  if (typeof handle?.close === "function") {
    await handle.close();
  }
}

async function openSQLiteDatabase(SQL, service) {
  const persisted = await loadSQLiteSnapshot(service);
  if (persisted) {
    log("Loaded SQLite snapshot from IndexedDB.");
    return { db: new SQL.Database(persisted), restored: true };
  }
  const seedPath = service.config.seedPath || "";
  if (isSQLiteDatabasePath(seedPath)) {
    const bytes = new Uint8Array(await fetchBytes(seedPath));
    log("Loaded SQLite seed database.");
    return { db: new SQL.Database(bytes), restored: false };
  }
  return { db: new SQL.Database(), restored: false };
}

async function executeSQLAssets(db, service) {
  for (const path of databaseSQLAssetPaths(service)) {
    const sql = await fetchText(path);
    if (sql.trim()) await db.exec(sql);
    log(`Executed ${path}.`);
  }
}

async function executeSQLiteAssets(db, service) {
  for (const path of sqliteSQLAssetPaths(service, isSQLiteDatabasePath)) {
    const sql = await fetchText(path);
    if (sql.trim()) db.run(sql);
    log(`Executed ${path}.`);
  }
  await saveSQLiteSnapshot(service, db);
}

async function loadSQLiteSnapshot(service) {
  if (!sqlitePersists(service)) return null;
  const value = await sqliteStoreRequest("readonly", (store) => store.get(sqliteStorageKey(service)));
  if (!value) return null;
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

async function saveSQLiteSnapshot(service, db) {
  if (!sqlitePersists(service)) return;
  const snapshot = db.export();
  await sqliteStoreRequest("readwrite", (store) => store.put(snapshot, sqliteStorageKey(service)));
}

async function deleteSQLiteSnapshot(service) {
  if (!sqlitePersists(service)) return;
  await sqliteStoreRequest("readwrite", (store) => store.delete(sqliteStorageKey(service)));
  log("Deleted SQLite IndexedDB snapshot.");
}

function sqliteStoreRequest(mode, createRequest) {
  if (!("indexedDB" in globalThis)) {
    log("IndexedDB is not available; SQLite persistence is disabled.", "warn");
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("pocketstack-sqlite", 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains("databases")) {
        open.result.createObjectStore("databases");
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("databases", mode);
      const store = transaction.objectStore("databases");
      const request = createRequest(store);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

function renderQueryPanel(service, runQuery) {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = `<h2>${escapeHTML(service.name)}</h2><textarea rows="6" style="width:100%">select 1;</textarea><p><button type="button">Run query</button></p><pre style="height:auto;min-height:120px"></pre>`;
  const textarea = panel.querySelector("textarea");
  const output = panel.querySelector("pre");
  panel.querySelector("button").addEventListener("click", async () => {
    try {
      output.textContent = await runQuery(textarea.value);
    } catch (error) {
      output.textContent = error.message;
    }
  });
  $("#preview").replaceChildren(panel);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

async function init() {
  state.manifest = await loadManifest();
  if (state.manifest.warnings?.length) {
    state.manifest.warnings.forEach((warning) => log(warning, "warn"));
  }
  globalThis.PocketStack = {
    query: queryDatabaseService,
    services: state.manifest.services,
  };
  installFrontendBridgeHandler();
  try {
    await ensureRuntimeServicesRegistered();
  } catch (error) {
    log(`PocketStack service worker is not active yet: ${error.message}`, "warn");
  }
  document.querySelectorAll("[data-service]").forEach((button) => {
    button.addEventListener("click", () => {
      const service = state.manifest.services.find((item) => item.name === button.dataset.service);
      if (service) selectService(service);
    });
  });
  $("#start").addEventListener("click", startSelected);
  $("#reset").addEventListener("click", resetSelected);
  if (state.manifest.services.length) selectService(state.manifest.services[0]);
  setStatus("Ready", "ok");
}

init().catch((error) => {
  setStatus("Runtime failed", "danger");
  log(error.stack || error.message, "error");
});

export { splitCommand };
