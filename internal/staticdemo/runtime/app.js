// runtime/src/app.ts
var state = {
  manifest: null,
  selected: null,
  webcontainers: /* @__PURE__ */ new Map()
};
var $ = (selector) => document.querySelector(selector);
var logBox = () => $("#logs");
function log(message, tone = "") {
  const prefix = tone ? `[${tone}] ` : "";
  logBox().textContent += `${prefix}${message}
`;
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
function asset(service, name) {
  return (service.assets || []).find((item) => item.name === name);
}
function splitCommand(command) {
  const parts = [];
  let current = "";
  let quote = "";
  for (const char of command || "") {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = "";
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
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
  setDetails(service.image || service.adapter);
  renderPreview(service);
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
  panel.innerHTML = `<h2>${service.name}</h2><p>${descriptionFor(service)}</p>`;
  preview.append(panel);
}
function descriptionFor(service) {
  switch (service.adapter) {
    case "frontend":
      return "Start this service to install dependencies and run it in a browser WebContainer.";
    case "wasi":
      return "Start this service to execute the prebuilt WebAssembly module in the browser.";
    case "mock-http":
      return `Mock routes are served under <code>/__pocketstack/mock/${service.name}/</code>.`;
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
  if (service.adapter === "postgres-pglite" || service.adapter === "sqlite") {
    const prefix = `pocketstack:${service.name}:`;
    Object.keys(localStorage).filter((key) => key.startsWith(prefix)).forEach((key) => localStorage.removeItem(key));
  }
  logBox().textContent = "";
  renderPreview(service);
  setStatus(`${service.name}: reset`);
}
async function startFrontend(service) {
  if (!crossOriginIsolated) {
    log("This host is not cross-origin isolated. WebContainer requires COOP/COEP headers.", "warn");
  }
  const project = asset(service, "project");
  if (!project) throw new Error("frontend project asset missing");
  const { WebContainer } = await import("https://esm.sh/@webcontainer/api");
  let container = state.webcontainers.get(service.name);
  if (!container) {
    container = await WebContainer.boot();
    state.webcontainers.set(service.name, container);
    await container.mount(await webcontainerTree(project));
  }
  container.on("server-ready", (_port, url) => {
    const frame = document.createElement("iframe");
    frame.title = `${service.name} frontend`;
    frame.src = url;
    $("#preview").replaceChildren(frame);
    log(`Frontend server ready at ${url}`);
  });
  await runContainerCommand(container, service.config.install || "npm install");
  runContainerCommand(container, service.config.start || "npm run dev -- --host 0.0.0.0");
}
async function webcontainerTree(project) {
  const root = {};
  for (const file of project.files || []) {
    const content = await fetchText(`${project.path}/${file}`);
    const parts = file.split("/");
    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ||= { directory: {} };
      cursor = cursor[part].directory;
    }
    cursor[parts.at(-1)] = { file: { contents: content } };
  }
  return root;
}
async function runContainerCommand(container, command) {
  const [bin, ...args] = splitCommand(command);
  if (!bin) return;
  log(`$ ${command}`);
  const process = await container.spawn(bin, args);
  process.output.pipeTo(new WritableStream({
    write(data) {
      log(String(data).replace(/\n$/, ""));
    }
  }));
  return process.exit;
}
async function startWASI(service) {
  const module = service.config.modulePath;
  if (!module) throw new Error("WASI module path missing");
  const bytes = await fetchBytes(module);
  try {
    const instance = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: wasiPreview(service),
      env: {}
    });
    const exports = instance.instance?.exports || instance.exports;
    if (typeof exports._start === "function") exports._start();
    log("WASM module instantiated in the browser.");
  } catch (error) {
    log("Generic WebAssembly instantiation failed; trying Wasmer JS.", "warn");
    const wasmer = await import("https://esm.sh/@wasmer/sdk");
    if (typeof wasmer.init === "function") await wasmer.init();
    log("Wasmer JS loaded. This module may require runtime-specific WASI bindings.");
    throw error;
  }
}
function wasiPreview() {
  return {
    fd_write(_fd, _iovs, _iovsLen, nwritten) {
      try {
        new DataView(new ArrayBuffer(4)).setUint32(nwritten, 0, true);
      } catch (_) {
      }
      return 0;
    },
    proc_exit(code) {
      log(`WASI process exited with code ${code}`);
    }
  };
}
async function startMock(service) {
  const registration = await navigator.serviceWorker.register("./mock-sw.js");
  const routes = await loadFixtureRoutes(service);
  const worker = registration.active || registration.waiting || registration.installing;
  if (worker) worker.postMessage({ type: "POCKETSTACK_ROUTES", service: service.name, routes });
  log(`Registered ${routes.length} mock route(s).`);
  renderMockRoutes(service, routes);
}
async function loadFixtureRoutes(service) {
  const fixtures = asset(service, "fixtures");
  const routes = [];
  if (!fixtures) return routes;
  for (const file of fixtures.files || []) {
    if (!file.endsWith(".json")) continue;
    const payload = JSON.parse(await fetchText(`${fixtures.path}/${file}`));
    routes.push({
      method: (payload.method || "GET").toUpperCase(),
      path: payload.path || `/${file.replace(/\.json$/, "")}`,
      status: payload.status || 200,
      headers: payload.headers || { "content-type": "application/json" },
      body: payload.body ?? payload
    });
  }
  return routes;
}
function renderMockRoutes(service, routes) {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = `<h2>${service.name}</h2>${routes.map((route) => {
    const url = `/__pocketstack/mock/${service.name}${route.path}`;
    return `<p><code>${route.method} ${url}</code></p>`;
  }).join("")}`;
  $("#preview").replaceChildren(panel);
}
async function startPGlite(service) {
  const { PGlite } = await import("https://cdn.jsdelivr.net/npm/@electric-sql/pglite/dist/index.js");
  const persist = service.config.persist === "memory" ? "memory://" : `idb://pocketstack-${service.name}`;
  const db = new PGlite(persist);
  await executeSQLAssets(db, service);
  log("PGlite database initialized.");
  renderQueryPanel(service, async (sql) => {
    const rows = await db.query(sql);
    return JSON.stringify(rows.rows || rows, null, 2);
  });
}
async function startSQLite(service) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js");
  const SQL = await window.initSqlJs({
    locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
  });
  const db = new SQL.Database();
  await executeSQLiteAssets(db, service);
  log("SQLite database initialized.");
  renderQueryPanel(service, async (sql) => {
    const result = db.exec(sql);
    return JSON.stringify(result, null, 2);
  });
}
async function executeSQLAssets(db, service) {
  for (const key of ["initPath", "seedPath"]) {
    if (service.config[key]) {
      const sql = await fetchText(service.config[key]);
      if (sql.trim()) await db.exec(sql);
      log(`Executed ${key}.`);
    }
  }
}
async function executeSQLiteAssets(db, service) {
  for (const key of ["initPath", "seedPath"]) {
    if (service.config[key]) {
      const sql = await fetchText(service.config[key]);
      if (sql.trim()) db.run(sql);
      log(`Executed ${key}.`);
    }
  }
}
function renderQueryPanel(service, runQuery) {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = `<h2>${service.name}</h2><textarea rows="6" style="width:100%">select 1;</textarea><p><button type="button">Run query</button></p><pre style="height:auto;min-height:120px"></pre>`;
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
export {
  splitCommand
};
