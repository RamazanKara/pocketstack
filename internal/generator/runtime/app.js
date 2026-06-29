// runtime/src/db-assets.ts
function configList(value = "") {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}
function databaseSQLAssetPaths(service) {
  const config = service.config || {};
  return [
    ...configList(config.initPath),
    ...configList(config.initScripts),
    ...configList(config.seedPath),
    ...configList(config.seedScripts)
  ];
}
function sqliteSQLAssetPaths(service, isDatabasePath = () => false) {
  const config = service.config || {};
  const seedPath = String(config.seedPath || "");
  return [
    ...configList(config.initPath),
    ...configList(config.initScripts),
    ...seedPath && !isDatabasePath(seedPath) ? [seedPath] : [],
    ...configList(config.seedScripts)
  ];
}

// runtime/src/frontend-adapter.ts
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([
  ".cjs",
  ".css",
  ".csv",
  ".env",
  ".gitignore",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);
var TEXT_FILENAMES = /* @__PURE__ */ new Set([
  ".env",
  ".gitignore",
  "dockerfile",
  "license",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock"
]);
var FRONTEND_BRIDGE_FILE = "__pocketstack_bridge.js";
function extension(path = "") {
  const basename = path.split("/").pop() || "";
  const index = basename.lastIndexOf(".");
  return index >= 0 ? basename.slice(index).toLowerCase() : "";
}
function isTextProjectFile(path = "") {
  const basename = path.split("/").pop()?.toLowerCase() || "";
  return TEXT_FILENAMES.has(basename) || TEXT_EXTENSIONS.has(extension(path));
}
function normalizeProjectFile(path) {
  const normalized = String(path || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`invalid project file path ${path}`);
  }
  return parts;
}
async function createWebContainerTree(project, readFile, options = {}) {
  const root = {};
  const virtualFiles = options.virtualFiles || {};
  const files = [...project.files || []];
  for (const file of Object.keys(virtualFiles)) {
    if (!files.includes(file)) files.push(file);
  }
  for (const file of files) {
    const parts = normalizeProjectFile(file);
    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ||= { directory: {} };
      cursor = cursor[part].directory;
    }
    let contents = Object.prototype.hasOwnProperty.call(virtualFiles, file) ? virtualFiles[file] : await readFile(file);
    if (typeof contents === "string" && typeof options.transformTextFile === "function") {
      contents = options.transformTextFile(file, contents);
    }
    cursor[parts.at(-1)] = { file: { contents } };
  }
  return root;
}
function frontendBridgeServices(services = []) {
  return services.filter((service) => ["mock-http", "postgres-pglite", "sqlite"].includes(service?.adapter) && service.name).map((service) => ({
    name: service.name,
    adapter: service.adapter,
    publicPort: Number(service.publicPort || 0)
  }));
}
function frontendBridgeOptions(services = []) {
  const bridgeServices = frontendBridgeServices(services);
  if (bridgeServices.length === 0) return {};
  const config = JSON.stringify({ services: bridgeServices });
  return {
    virtualFiles: {
      [FRONTEND_BRIDGE_FILE]: frontendBridgeScript()
    },
    transformTextFile(file, contents) {
      if (!isHTMLFile(file)) return contents;
      return injectFrontendBridge(contents, config);
    }
  };
}
function isHTMLFile(file = "") {
  return /\.html?$/i.test(file.replaceAll("\\", "/"));
}
function injectFrontendBridge(html, config) {
  if (html.includes(FRONTEND_BRIDGE_FILE)) return html;
  const snippet2 = `<script>window.__POCKETSTACK_BRIDGE_CONFIG__=${config};<\/script><script type="module" src="/${FRONTEND_BRIDGE_FILE}"><\/script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet2}</head>`);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, `<body$1>${snippet2}`);
  return `${snippet2}${html}`;
}
function frontendBridgeScript() {
  return `const config=window.__POCKETSTACK_BRIDGE_CONFIG__||{services:[]};
const originalFetch=window.fetch.bind(window);
let sequence=0;
function portMatches(url,service){return !url.port||!service.publicPort||Number(url.port)===Number(service.publicPort);}
function serviceForURL(raw){
  let url;
  try{url=new URL(raw,window.location.href);}catch{return null;}
  const marker=url.pathname.match(/\\/__pocketstack\\/(mock|db)\\/([^/]+)/);
  if(marker)return {kind:marker[1],name:decodeURIComponent(marker[2])};
  if(url.protocol!=="http:"&&url.protocol!=="https:")return null;
  const service=(config.services||[]).find((item)=>url.hostname===item.name&&portMatches(url,item));
  if(!service)return null;
  return {kind:service.adapter==="mock-http"?"mock":"db",name:service.name};
}
function requestBody(request){
  if(request.method==="GET"||request.method==="HEAD")return Promise.resolve("");
  return request.clone().text();
}
function sendBridge(message){
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timeout=setTimeout(()=>{window.removeEventListener("message",listener);reject(new Error("PocketStack bridge request timed out"));},30000);
    function listener(event){
      if(event.source!==window.parent||!event.data||event.data.type!=="POCKETSTACK_BRIDGE_RESPONSE"||event.data.id!==id)return;
      clearTimeout(timeout);
      window.removeEventListener("message",listener);
      if(event.data.ok)resolve(event.data.response);
      else reject(new Error(event.data.error||"PocketStack bridge request failed"));
    }
    window.addEventListener("message",listener);
    window.parent.postMessage({...message,id,type:"POCKETSTACK_BRIDGE_FETCH"},"*");
  });
}
window.fetch=async function pocketstackFetch(input,init){
  const request=new Request(input,init);
  if(window.parent===window||!serviceForURL(request.url))return originalFetch(input,init);
  const response=await sendBridge({
    url:request.url,
    method:request.method,
    headers:[...request.headers.entries()],
    body:await requestBody(request)
  });
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
};
window.PocketStackBridge={services:config.services||[]};`;
}
function frontendDisplayCommand(command) {
  return String(command || "").trim();
}
function splitCommand(command) {
  const parts = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of command || "") {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
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
  if (escaped) current += "\\";
  if (current) parts.push(current);
  return parts;
}
function frontendEnvironment(env = {}) {
  const result = {};
  const entries = environmentEntries(env);
  for (const entry of entries) {
    const [key, value = ""] = splitEnvironmentEntry(entry);
    if (key) result[key] = value;
  }
  return result;
}
function environmentEntries(env = {}) {
  if (Array.isArray(env)) return env.map(String);
  if (typeof env === "string") {
    return env.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}
function splitEnvironmentEntry(entry) {
  const text = String(entry || "");
  const index = text.indexOf("=");
  if (index < 0) return [text.trim(), ""];
  return [text.slice(0, index).trim(), text.slice(index + 1)];
}

// runtime/src/mock-routes.ts
var HTTP_METHODS = /* @__PURE__ */ new Set(["get", "put", "post", "delete", "patch", "options", "head"]);
function statusFromKey(key) {
  const value = Number.parseInt(key, 10);
  return Number.isFinite(value) ? value : 200;
}
function chooseResponse(responses = {}) {
  if (responses["200"]) return ["200", responses["200"]];
  const successKey = Object.keys(responses).find((key) => /^2\d\d$/.test(key));
  if (successKey) return [successKey, responses[successKey]];
  if (responses.default) return ["200", responses.default];
  const [firstKey] = Object.keys(responses);
  return [firstKey || "200", responses[firstKey] || {}];
}
function responseAllowsBody(method, status) {
  return method.toUpperCase() !== "HEAD" && ![204, 205, 304].includes(status);
}
function resolvePointer(document2, pointer) {
  if (!pointer?.startsWith("#/")) return void 0;
  return pointer.slice(2).split("/").reduce((cursor, segment) => {
    if (cursor === void 0 || cursor === null) return void 0;
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    return cursor[key];
  }, document2);
}
function resolveRef(value, document2, seen = /* @__PURE__ */ new Set()) {
  if (!value || typeof value !== "object" || !value.$ref) return value;
  if (seen.has(value.$ref)) return {};
  seen.add(value.$ref);
  const resolved = resolvePointer(document2, value.$ref);
  return resolveRef(resolved || {}, document2, seen);
}
function chooseContent(response = {}) {
  const content = response.content || {};
  const entries = Object.entries(content);
  const ranked = entries.map(([contentType2, value]) => [contentType2, value, contentRank(contentType2)]).sort((left, right) => right[2] - left[2]);
  const [contentType, preferred] = ranked[0] || ["application/json", {}];
  return [contentType, preferred || {}];
}
function contentRank(contentType = "") {
  const normalized = contentType.toLowerCase().split(";")[0].trim();
  if (normalized === "application/json") return 100;
  if (normalized === "application/problem+json") return 90;
  if (normalized.endsWith("+json")) return 80;
  if (normalized === "text/plain") return 70;
  return 0;
}
function firstExample(examples = {}, document2) {
  const first = resolveRef(examples[Object.keys(examples)[0]], document2);
  if (!first) return void 0;
  if (Object.prototype.hasOwnProperty.call(first, "value")) return first.value;
  return first;
}
function exampleFromSchema(schema2 = {}, fallback, document2, seen = /* @__PURE__ */ new Set()) {
  schema2 = resolveRef(schema2, document2, seen);
  if (Object.prototype.hasOwnProperty.call(schema2, "example")) return schema2.example;
  if (Object.prototype.hasOwnProperty.call(schema2, "default")) return schema2.default;
  if (schema2.enum?.length) return schema2.enum[0];
  if (schema2.oneOf?.length || schema2.anyOf?.length) {
    return exampleFromSchema(schema2.oneOf?.[0] || schema2.anyOf?.[0], fallback, document2, seen);
  }
  if (schema2.allOf?.length) {
    return schema2.allOf.reduce((merged, item) => {
      const value = exampleFromSchema(item, fallback, document2, seen);
      if (value && typeof value === "object" && !Array.isArray(value) && merged && typeof merged === "object" && !Array.isArray(merged)) {
        return { ...merged, ...value };
      }
      return value;
    }, {});
  }
  switch (schema2.type) {
    case "string":
      return schema2.format === "date-time" ? "2026-05-26T00:00:00Z" : "string";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return true;
    case "array":
      return [exampleFromSchema(schema2.items || {}, fallback, document2, seen)];
    case "object": {
      const result = {};
      for (const [name, property] of Object.entries(schema2.properties || {})) {
        result[name] = exampleFromSchema(property, fallback, document2, seen);
      }
      return result;
    }
    default:
      return fallback;
  }
}
function responseBodyFor(method, path, content, document2) {
  content = resolveRef(content, document2);
  if (Object.prototype.hasOwnProperty.call(content, "example")) return content.example;
  const fromExamples = firstExample(content.examples, document2);
  if (fromExamples !== void 0) return fromExamples;
  return exampleFromSchema(content.schema, {
    mock: true,
    method: method.toUpperCase(),
    path
  }, document2);
}
function responseHeaders(response = {}, contentType, document2) {
  const headers = {};
  for (const [name, rawHeader] of Object.entries(response.headers || {})) {
    const header = resolveRef(rawHeader, document2);
    const value = headerValue(header, document2);
    if (value !== void 0) headers[name] = String(value);
  }
  if (contentType) headers["content-type"] = contentType;
  return headers;
}
function headerValue(header = {}, document2) {
  if (Object.prototype.hasOwnProperty.call(header, "example")) return header.example;
  const fromExamples = firstExample(header.examples, document2);
  if (fromExamples !== void 0) return fromExamples;
  return exampleFromSchema(header.schema, void 0, document2);
}
function routeFromOperation(path, method, operation = {}, document2, pathItem = {}) {
  operation = resolveRef(operation, document2);
  const [statusKey, rawResponse] = chooseResponse(operation.responses || {});
  const status = statusFromKey(statusKey);
  const response = resolveRef(rawResponse, document2);
  const bodyAllowed = responseAllowsBody(method, status);
  const [contentType, content] = bodyAllowed ? chooseContent(response) : ["", {}];
  const body = bodyAllowed ? responseBodyFor(method, path, content, document2) : void 0;
  const headers = responseHeaders(response, bodyAllowed ? contentType : "", document2);
  const query = queryFromParameters(mergedParameters(pathItem.parameters, operation.parameters, document2), document2);
  const route = {
    method: method.toUpperCase(),
    path: path.startsWith("/") ? path : `/${path}`,
    ...query ? { query } : {},
    status,
    ...Object.keys(headers).length ? { headers } : {},
    source: "openapi"
  };
  if (bodyAllowed) route.body = body;
  return route;
}
function mergedParameters(pathParameters = [], operationParameters = [], document2) {
  const byKey = /* @__PURE__ */ new Map();
  for (const rawParameter of pathParameters || []) {
    const parameter = resolveRef(rawParameter, document2);
    if (parameter?.in && parameter?.name) byKey.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  for (const rawParameter of operationParameters || []) {
    const parameter = resolveRef(rawParameter, document2);
    if (parameter?.in && parameter?.name) byKey.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...byKey.values()];
}
function queryFromParameters(parameters = [], document2) {
  const search = new URLSearchParams();
  for (const parameter of parameters) {
    if (parameter.in !== "query" || !parameter.required) continue;
    const value = parameterExample(parameter, document2);
    if (value === void 0) continue;
    search.set(parameter.name, String(value));
  }
  return search.toString();
}
function parameterExample(parameter = {}, document2) {
  parameter = resolveRef(parameter, document2);
  if (Object.prototype.hasOwnProperty.call(parameter, "example")) return parameter.example;
  const fromExamples = firstExample(parameter.examples, document2);
  if (fromExamples !== void 0) return fromExamples;
  return exampleFromSchema(parameter.schema, void 0, document2);
}
function keyFor(route) {
  return `${route.method.toUpperCase()} ${route.path}${route.query ? `?${route.query}` : ""}`;
}
function splitRoutePath(rawPath = "") {
  const [pathPart, query = ""] = String(rawPath || "").split("?");
  return {
    path: pathPart.startsWith("/") ? pathPart : `/${pathPart}`,
    query
  };
}
function normalizeFixtureRoute(route) {
  const path = splitRoutePath(route.path || "");
  const status = typeof route.status === "number" ? route.status : statusFromKey(route.status || "200");
  const method = (route.method || "GET").toUpperCase();
  const bodyAllowed = responseAllowsBody(method, status);
  const body = route.body !== void 0 ? { body: route.body } : route.bodyFrom ? {} : { body: route };
  const normalized = {
    method,
    path: path.path,
    ...path.query ? { query: path.query } : {},
    status,
    headers: route.headers || (bodyAllowed ? { "content-type": "application/json" } : {}),
    ...bodyAllowed && route.bodyFrom ? { bodyFrom: route.bodyFrom } : {},
    ...bodyAllowed ? body : {},
    source: route.source || "fixture"
  };
  if (!Object.keys(normalized.headers).length) delete normalized.headers;
  return normalized;
}
function routesFromOpenAPIDocument(document2) {
  const routes = [];
  const paths = document2?.paths || {};
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = resolveRef(rawPathItem, document2);
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      routes.push(routeFromOperation(path, method, operation, document2, pathItem));
    }
  }
  return routes;
}
function mergeMockRoutes(openAPIRoutes = [], fixtureRoutes = []) {
  const byKey = /* @__PURE__ */ new Map();
  for (const route of openAPIRoutes) byKey.set(keyFor(route), route);
  for (const route of fixtureRoutes.map(normalizeFixtureRoute)) byKey.set(keyFor(route), route);
  return [...byKey.values()];
}

// runtime/src/pglite-adapter.ts
var BOOTSTRAP_TABLE = "__pocketstack_bootstrap";
function pglitePersistMode(service) {
  return service?.config?.persist === "memory" ? "memory" : "indexeddb";
}
function pglitePersists(service) {
  return pglitePersistMode(service) === "indexeddb";
}
function pgliteIndexedDBName(service) {
  const namespace = service?.config?.storageNamespace;
  const serviceName = storageToken(service?.name || "service");
  if (!namespace) return `pocketstack-${serviceName}`;
  return `pocketstack-${storageToken(namespace)}-${serviceName}`;
}
function pgliteDataDir(service) {
  return pglitePersists(service) ? `idb://${pgliteIndexedDBName(service)}` : "memory://";
}
async function ensurePGliteBootstrapped(db, executeAssets, log2 = () => {
}) {
  await db.exec(`
    create table if not exists ${BOOTSTRAP_TABLE} (
      key text primary key,
      value text not null
    );
  `);
  const result = await db.query(`select value from ${BOOTSTRAP_TABLE} where key = 'assets'`);
  const rows = result.rows || result;
  if (rows.length > 0) {
    log2("PGlite bootstrap assets already applied.");
    return false;
  }
  await executeAssets();
  await db.exec(`
    insert into ${BOOTSTRAP_TABLE} (key, value)
    values ('assets', '1')
    on conflict (key) do update set value = excluded.value;
  `);
  return true;
}
function deleteIndexedDBDatabase(name) {
  if (!("indexedDB" in globalThis)) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB database ${name} is blocked by an open connection`));
  });
}
async function deletePGliteStorage(service) {
  if (!pglitePersists(service)) return false;
  return deleteIndexedDBDatabase(pgliteIndexedDBName(service));
}
function storageToken(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "demo";
}

// runtime/src/service-urls.ts
function serviceEnvName(name = "") {
  return String(name || "service").trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "SERVICE";
}
function mockServices(services = []) {
  return services.filter((service) => service?.adapter === "mock-http" && service.name);
}
function databaseServices(services = []) {
  return services.filter((service) => (service?.adapter === "postgres-pglite" || service?.adapter === "sqlite") && service.name);
}
function mockServiceBaseURL(service, baseHref = globalThis.location?.href || "http://localhost/") {
  return new URL(`./__pocketstack/mock/${encodeURIComponent(service.name)}`, baseHref).toString();
}
function databaseServiceBaseURL(service, baseHref = globalThis.location?.href || "http://localhost/") {
  return new URL(`./__pocketstack/db/${encodeURIComponent(service.name)}`, baseHref).toString();
}
function frontendBridgeNeeded(services = []) {
  return mockServices(services).length > 0 || databaseServices(services).length > 0;
}
function servicePortMatches(url, service) {
  return !url.port || !service.publicPort || Number(url.port) === Number(service.publicPort);
}
function rewriteMockServiceURL(value, services = [], baseHref = globalThis.location?.href || "http://localhost/") {
  if (typeof value !== "string" || value.trim() === "") return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return value;
  const service = mockServices(services).find((candidate) => url.hostname === candidate.name && servicePortMatches(url, candidate));
  if (!service) return value;
  const base = `${mockServiceBaseURL(service, baseHref)}/`;
  const suffix = url.pathname === "/" ? "" : url.pathname.replace(/^\/+/, "");
  const rewritten = new URL(suffix, base);
  rewritten.search = url.search;
  rewritten.hash = url.hash;
  const output = rewritten.toString();
  return suffix || url.search || url.hash ? output : output.replace(/\/$/, "");
}
function frontendServiceEnvironment(env = {}, services = [], baseHref = globalThis.location?.href || "http://localhost/") {
  const next = { ...env };
  for (const [key, value] of Object.entries(next)) {
    next[key] = rewriteMockServiceURL(value, services, baseHref);
  }
  for (const service of mockServices(services)) {
    const name = serviceEnvName(service.name);
    const url = mockServiceBaseURL(service, baseHref);
    next[`POCKETSTACK_${name}_URL`] ??= url;
    next[`VITE_POCKETSTACK_${name}_URL`] ??= url;
  }
  for (const service of databaseServices(services)) {
    const name = serviceEnvName(service.name);
    const url = databaseServiceBaseURL(service, baseHref);
    next[`POCKETSTACK_${name}_URL`] ??= url;
    next[`VITE_POCKETSTACK_${name}_URL`] ??= url;
    next[`POCKETSTACK_${name}_DB_URL`] ??= url;
    next[`VITE_POCKETSTACK_${name}_DB_URL`] ??= url;
  }
  if (frontendBridgeNeeded(services)) {
    next.POCKETSTACK_BRIDGE_URL ??= "/__pocketstack_bridge.js";
    next.VITE_POCKETSTACK_BRIDGE_URL ??= "/__pocketstack_bridge.js";
  }
  return next;
}

// runtime/src/sqlite-adapter.ts
function sqlitePersistMode(service) {
  return service?.config?.persist === "memory" ? "memory" : "indexeddb";
}
function sqlitePersists(service) {
  return sqlitePersistMode(service) === "indexeddb";
}
function sqliteStorageKey(service) {
  const namespace = service?.config?.storageNamespace;
  const serviceName = storageToken2(service?.name || "service");
  if (!namespace) return `pocketstack:sqlite:${serviceName}`;
  return `pocketstack:sqlite:${storageToken2(namespace)}:${serviceName}`;
}
function isSQLiteDatabasePath(path = "") {
  return /\.(db|sqlite|sqlite3)$/i.test(path);
}
function storageToken2(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "demo";
}

// runtime/src/wasi-preview.ts
var WASI_ERRNO = {
  success: 0,
  badf: 8,
  inval: 28,
  noent: 44,
  nosys: 52,
  notsup: 58
};
var WASI_FILETYPE = {
  unknown: 0,
  characterDevice: 2,
  directory: 3
};
var WASI_RIGHTS_STDIO = 0x40n | 0x80n | 0x10000000000000n;
var WASI_RIGHTS_PREOPEN = 0x1fffffffn;
var WASIExit = class extends Error {
  constructor(code) {
    super(`WASI process exited with code ${code}`);
    this.name = "WASIExit";
    this.code = code;
  }
};
function normalizeEnvironment(env = {}) {
  if (Array.isArray(env)) return env.map(String).sort();
  if (typeof env === "string") {
    return env.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).sort();
  }
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).sort();
}
function normalizeEnvironmentRecord(env = {}) {
  const record = {};
  for (const item of normalizeEnvironment(env)) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    record[item.slice(0, index)] = item.slice(index + 1);
  }
  return record;
}
function encodedSize(values, encoder) {
  return values.reduce((size, value) => size + encoder.encode(value).length + 1, 0);
}
function createWASIImportObject(imports, envImports = {}) {
  return {
    wasi_snapshot_preview1: imports,
    wasi_unstable: imports,
    env: envImports
  };
}
function wasmerRunOptions(service = {}, args = [], env = {}) {
  return {
    program: service.name || "pocketstack-wasi",
    args,
    env: normalizeEnvironmentRecord(env)
  };
}
function createWASIPreviewImports(options) {
  const service = options.service || {};
  const argv = [service.name || "pocketstack-wasi", ...options.args || []];
  const environ = normalizeEnvironment(options.env);
  const preopens = normalizePreopens(options.preopens);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const log2 = options.log || (() => {
  });
  const now = options.now || (() => Date.now());
  const randomBytes = options.randomBytes || ((target) => crypto.getRandomValues(target));
  const stdioBuffers = /* @__PURE__ */ new Map();
  function memory() {
    const instance = options.getInstance();
    return instance?.exports?.memory;
  }
  function view() {
    const current = memory();
    if (!current) throw new Error("WASI module does not export memory");
    return new DataView(current.buffer);
  }
  function bytes() {
    const current = memory();
    if (!current) throw new Error("WASI module does not export memory");
    return new Uint8Array(current.buffer);
  }
  function writeCString(offset, value) {
    bytes().set(encoder.encode(`${value}\0`), offset);
  }
  function writeStringArray(values, pointers, buffer) {
    const currentView = view();
    let offset = buffer;
    values.forEach((value, index) => {
      currentView.setUint32(pointers + index * 4, offset, true);
      writeCString(offset, value);
      offset += encoder.encode(value).length + 1;
    });
  }
  function isStdio(fd) {
    return fd === 0 || fd === 1 || fd === 2;
  }
  function preopenFor(fd) {
    return preopens.find((preopen) => preopen.fd === fd) || null;
  }
  function fdExists(fd) {
    return isStdio(fd) || Boolean(preopenFor(fd));
  }
  function fdNoop(fd) {
    return fdExists(fd) ? WASI_ERRNO.success : WASI_ERRNO.badf;
  }
  function fdUnsupported(fd) {
    return fdExists(fd) ? WASI_ERRNO.notsup : WASI_ERRNO.badf;
  }
  function preopenUnsupported(fd) {
    return preopenFor(fd) ? WASI_ERRNO.notsup : WASI_ERRNO.badf;
  }
  function emitOutput(fd, chunk, flush = false) {
    const previous = stdioBuffers.get(fd) || "";
    const combined = previous + chunk;
    const lines = combined.split(/\n/);
    const pending = lines.pop() || "";
    for (const line of lines) {
      if (line !== "") log2(line, fd === 2 ? "stderr" : "");
    }
    if (flush && pending !== "") {
      log2(pending, fd === 2 ? "stderr" : "");
    }
    stdioBuffers.set(fd, flush ? "" : pending);
  }
  function flushOutput() {
    for (const [fd, pending] of stdioBuffers) {
      if (pending) log2(pending, fd === 2 ? "stderr" : "");
      stdioBuffers.set(fd, "");
    }
  }
  function writeFdStat(fd, pointer) {
    const currentView = view();
    const preopen = preopenFor(fd);
    if (!isStdio(fd) && !preopen) return WASI_ERRNO.badf;
    currentView.setUint8(pointer, preopen ? WASI_FILETYPE.directory : WASI_FILETYPE.characterDevice);
    currentView.setUint16(pointer + 2, 0, true);
    currentView.setBigUint64(pointer + 8, preopen ? WASI_RIGHTS_PREOPEN : WASI_RIGHTS_STDIO, true);
    currentView.setBigUint64(pointer + 16, preopen ? WASI_RIGHTS_PREOPEN : WASI_RIGHTS_STDIO, true);
    return WASI_ERRNO.success;
  }
  function writeFileStat(pointer, filetype) {
    const currentView = view();
    currentView.setBigUint64(pointer, 0n, true);
    currentView.setBigUint64(pointer + 8, 0n, true);
    currentView.setUint8(pointer + 16, filetype);
    currentView.setBigUint64(pointer + 24, 0n, true);
    currentView.setBigUint64(pointer + 32, BigInt(now()) * 1000000n, true);
    currentView.setBigUint64(pointer + 40, BigInt(now()) * 1000000n, true);
    currentView.setBigUint64(pointer + 48, BigInt(now()) * 1000000n, true);
  }
  function readPath(pointer, length) {
    return decoder.decode(bytes().slice(pointer, pointer + length));
  }
  function isRootPath(path) {
    return path === "" || path === "." || path === "/";
  }
  return {
    __pocketstack_flush: flushOutput,
    args_sizes_get(argc, argvBufSize) {
      const currentView = view();
      currentView.setUint32(argc, argv.length, true);
      currentView.setUint32(argvBufSize, encodedSize(argv, encoder), true);
      return WASI_ERRNO.success;
    },
    args_get(argvPointer, argvBuffer) {
      writeStringArray(argv, argvPointer, argvBuffer);
      return WASI_ERRNO.success;
    },
    environ_sizes_get(environCount, environBufSize) {
      const currentView = view();
      currentView.setUint32(environCount, environ.length, true);
      currentView.setUint32(environBufSize, encodedSize(environ, encoder), true);
      return WASI_ERRNO.success;
    },
    environ_get(environPointer, environBuffer) {
      writeStringArray(environ, environPointer, environBuffer);
      return WASI_ERRNO.success;
    },
    fd_write(fd, iovs, iovsLen, nwritten) {
      try {
        if (fd !== 1 && fd !== 2) return WASI_ERRNO.badf;
        const currentView = view();
        const currentBytes = bytes();
        const chunks = [];
        let written = 0;
        for (let index = 0; index < iovsLen; index += 1) {
          const pointer = currentView.getUint32(iovs + index * 8, true);
          const length = currentView.getUint32(iovs + index * 8 + 4, true);
          chunks.push(currentBytes.slice(pointer, pointer + length));
          written += length;
        }
        const merged = new Uint8Array(written);
        let mergeOffset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, mergeOffset);
          mergeOffset += chunk.length;
        }
        currentView.setUint32(nwritten, written, true);
        emitOutput(fd, decoder.decode(merged));
        return WASI_ERRNO.success;
      } catch (error) {
        log2(error.message, "wasi");
        return WASI_ERRNO.inval;
      }
    },
    fd_read(fd, _iovs, _iovsLen, nread) {
      if (fd !== 0) return WASI_ERRNO.badf;
      view().setUint32(nread, 0, true);
      return WASI_ERRNO.success;
    },
    fd_close(fd) {
      return fdNoop(fd);
    },
    fd_advise: fdNoop,
    fd_allocate: fdUnsupported,
    fd_datasync: fdNoop,
    fd_sync: fdNoop,
    fd_fdstat_set_rights: fdNoop,
    fd_filestat_set_size: fdUnsupported,
    fd_filestat_set_times: fdUnsupported,
    fd_pread(fd, _iovs, _iovsLen, _offset, nread) {
      if (!fdExists(fd)) return WASI_ERRNO.badf;
      view().setUint32(nread, 0, true);
      return WASI_ERRNO.notsup;
    },
    fd_pwrite(fd, _iovs, _iovsLen, _offset, nwritten) {
      if (!fdExists(fd)) return WASI_ERRNO.badf;
      view().setUint32(nwritten, 0, true);
      return WASI_ERRNO.notsup;
    },
    fd_renumber(fromFd, toFd) {
      if (!fdExists(fromFd) || !fdExists(toFd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.notsup;
    },
    fd_fdstat_get: writeFdStat,
    fd_fdstat_set_flags(fd) {
      return fdNoop(fd);
    },
    fd_filestat_get(fd, pointer) {
      const preopen = preopenFor(fd);
      if (!isStdio(fd) && !preopen) return WASI_ERRNO.badf;
      writeFileStat(pointer, preopen ? WASI_FILETYPE.directory : WASI_FILETYPE.characterDevice);
      return WASI_ERRNO.success;
    },
    fd_prestat_get(fd, pointer) {
      const preopen = preopenFor(fd);
      if (!preopen) return WASI_ERRNO.badf;
      const currentView = view();
      currentView.setUint8(pointer, 0);
      currentView.setUint32(pointer + 4, encoder.encode(preopen.path).length, true);
      return WASI_ERRNO.success;
    },
    fd_prestat_dir_name(fd, pointer, length) {
      const preopen = preopenFor(fd);
      if (!preopen) return WASI_ERRNO.badf;
      const encoded = encoder.encode(preopen.path);
      bytes().set(encoded.slice(0, length), pointer);
      return WASI_ERRNO.success;
    },
    fd_seek(fd, _offset, _whence, newOffset) {
      if (!isStdio(fd)) return WASI_ERRNO.badf;
      view().setBigUint64(newOffset, 0n, true);
      return WASI_ERRNO.success;
    },
    fd_tell(fd, offset) {
      if (!isStdio(fd)) return WASI_ERRNO.badf;
      view().setBigUint64(offset, 0n, true);
      return WASI_ERRNO.success;
    },
    path_create_directory: preopenUnsupported,
    path_open(fd) {
      if (!preopenFor(fd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.noent;
    },
    path_filestat_get(fd, _flags, pathPointer, pathLength, resultPointer) {
      if (!preopenFor(fd)) return WASI_ERRNO.badf;
      if (!isRootPath(readPath(pathPointer, pathLength))) return WASI_ERRNO.noent;
      writeFileStat(resultPointer, WASI_FILETYPE.directory);
      return WASI_ERRNO.success;
    },
    path_filestat_set_times: preopenUnsupported,
    path_link(oldFd, _oldFlags, _oldPath, _oldPathLength, newFd) {
      if (!preopenFor(oldFd) || !preopenFor(newFd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.notsup;
    },
    fd_readdir(fd, _buffer, _bufferLength, _cookie, bufferUsed) {
      if (!preopenFor(fd)) return WASI_ERRNO.badf;
      view().setUint32(bufferUsed, 0, true);
      return WASI_ERRNO.success;
    },
    path_readlink(fd) {
      if (!preopenFor(fd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.noent;
    },
    path_remove_directory: preopenUnsupported,
    path_rename(oldFd, _oldPath, _oldPathLength, newFd) {
      if (!preopenFor(oldFd) || !preopenFor(newFd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.notsup;
    },
    path_symlink(_oldPath, _oldPathLength, fd) {
      return preopenUnsupported(fd);
    },
    path_unlink_file: preopenUnsupported,
    random_get(pointer, length) {
      randomBytes(bytes().subarray(pointer, pointer + length));
      return WASI_ERRNO.success;
    },
    clock_res_get(_clockId, resolution) {
      view().setBigUint64(resolution, 1000000n, true);
      return WASI_ERRNO.success;
    },
    clock_time_get(_clockId, _precision, timestamp2) {
      view().setBigUint64(timestamp2, BigInt(now()) * 1000000n, true);
      return WASI_ERRNO.success;
    },
    poll_oneoff(_in, _out, _nsubscriptions, nevents) {
      view().setUint32(nevents, 0, true);
      return WASI_ERRNO.success;
    },
    sched_yield() {
      return WASI_ERRNO.success;
    },
    sock_accept() {
      return WASI_ERRNO.notsup;
    },
    sock_recv() {
      return WASI_ERRNO.notsup;
    },
    sock_send() {
      return WASI_ERRNO.notsup;
    },
    sock_shutdown() {
      return WASI_ERRNO.notsup;
    },
    proc_exit(code) {
      flushOutput();
      throw new WASIExit(code);
    }
  };
}
function normalizePreopens(preopens = [{ fd: 3, path: "/" }]) {
  if (!Array.isArray(preopens)) return [];
  return preopens.map((preopen, index) => ({
    fd: Number.isInteger(preopen?.fd) ? preopen.fd : index + 3,
    path: String(preopen?.path || "/")
  })).filter((preopen) => preopen.fd >= 3 && preopen.path);
}

// node_modules/js-yaml/dist/js-yaml.mjs
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
function toArray(sequence) {
  if (Array.isArray(sequence)) return sequence;
  else if (isNothing(sequence)) return [];
  return [sequence];
}
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length; index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0; cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
var isNothing_1 = isNothing;
var isObject_1 = isObject;
var toArray_1 = toArray;
var repeat_1 = repeat;
var isNegativeZero_1 = isNegativeZero;
var extend_1 = extend;
var common = {
  isNothing: isNothing_1,
  isObject: isObject_1,
  toArray: toArray_1,
  repeat: repeat_1,
  isNegativeZero: isNegativeZero_1,
  extend: extend_1
};
function formatError(exception2, compact) {
  var where = "", message = exception2.reason || "(unknown reason)";
  if (!exception2.mark) return message;
  if (exception2.mark.name) {
    where += 'in "' + exception2.mark.name + '" ';
  }
  where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
  if (!compact && exception2.mark.snippet) {
    where += "\n\n" + exception2.mark.snippet;
  }
  return message + " " + where;
}
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
YAMLException$1.prototype = Object.create(Error.prototype);
YAMLException$1.prototype.constructor = YAMLException$1;
YAMLException$1.prototype.toString = function toString(compact) {
  return this.name + ": " + formatError(this, compact);
};
var exception = YAMLException$1;
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
    // relative position
  };
}
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer) return null;
  if (!options.maxLength) options.maxLength = 79;
  if (typeof options.indent !== "number") options.indent = 1;
  if (typeof options.linesBefore !== "number") options.linesBefore = 3;
  if (typeof options.linesAfter !== "number") options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match;
  var foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1; i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo - i],
      lineEnds[foundLineNo - i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
      maxLineLength
    );
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + "\n" + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
  for (i = 1; i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo + i],
      lineEnds[foundLineNo + i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
      maxLineLength
    );
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  }
  return result.replace(/\n$/, "");
}
var snippet = makeSnippet;
var TYPE_CONSTRUCTOR_OPTIONS = [
  "kind",
  "multi",
  "resolve",
  "construct",
  "instanceOf",
  "predicate",
  "represent",
  "representName",
  "defaultStyle",
  "styleAliases"
];
var YAML_NODE_KINDS = [
  "scalar",
  "sequence",
  "mapping"
];
function compileStyleAliases(map2) {
  var result = {};
  if (map2 !== null) {
    Object.keys(map2).forEach(function(style) {
      map2[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function(name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new exception('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function() {
    return true;
  };
  this.construct = options["construct"] || function(data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
var type = Type$1;
function compileList(schema2, name) {
  var result = [];
  schema2[name].forEach(function(currentType) {
    var newIndex = result.length;
    result.forEach(function(previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  for (index = 0, length = arguments.length; index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
function Schema$1(definition) {
  return this.extend(definition);
}
Schema$1.prototype.extend = function extend2(definition) {
  var implicit = [];
  var explicit = [];
  if (definition instanceof type) {
    explicit.push(definition);
  } else if (Array.isArray(definition)) {
    explicit = explicit.concat(definition);
  } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
    if (definition.implicit) implicit = implicit.concat(definition.implicit);
    if (definition.explicit) explicit = explicit.concat(definition.explicit);
  } else {
    throw new exception("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
  }
  implicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
    if (type$1.loadKind && type$1.loadKind !== "scalar") {
      throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
    }
    if (type$1.multi) {
      throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    }
  });
  explicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
  });
  var result = Object.create(Schema$1.prototype);
  result.implicit = (this.implicit || []).concat(implicit);
  result.explicit = (this.explicit || []).concat(explicit);
  result.compiledImplicit = compileList(result, "implicit");
  result.compiledExplicit = compileList(result, "explicit");
  result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
  return result;
};
var schema = Schema$1;
var str = new type("tag:yaml.org,2002:str", {
  kind: "scalar",
  construct: function(data) {
    return data !== null ? data : "";
  }
});
var seq = new type("tag:yaml.org,2002:seq", {
  kind: "sequence",
  construct: function(data) {
    return data !== null ? data : [];
  }
});
var map = new type("tag:yaml.org,2002:map", {
  kind: "mapping",
  construct: function(data) {
    return data !== null ? data : {};
  }
});
var failsafe = new schema({
  explicit: [
    str,
    seq,
    map
  ]
});
function resolveYamlNull(data) {
  if (data === null) return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
function constructYamlNull() {
  return null;
}
function isNull(object) {
  return object === null;
}
var _null = new type("tag:yaml.org,2002:null", {
  kind: "scalar",
  resolve: resolveYamlNull,
  construct: constructYamlNull,
  predicate: isNull,
  represent: {
    canonical: function() {
      return "~";
    },
    lowercase: function() {
      return "null";
    },
    uppercase: function() {
      return "NULL";
    },
    camelcase: function() {
      return "Null";
    },
    empty: function() {
      return "";
    }
  },
  defaultStyle: "lowercase"
});
function resolveYamlBoolean(data) {
  if (data === null) return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
var bool = new type("tag:yaml.org,2002:bool", {
  kind: "scalar",
  resolve: resolveYamlBoolean,
  construct: constructYamlBoolean,
  predicate: isBoolean,
  represent: {
    lowercase: function(object) {
      return object ? "true" : "false";
    },
    uppercase: function(object) {
      return object ? "TRUE" : "FALSE";
    },
    camelcase: function(object) {
      return object ? "True" : "False";
    }
  },
  defaultStyle: "lowercase"
});
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
function resolveYamlInteger(data) {
  if (data === null) return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max) return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max) return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch !== "0" && ch !== "1") return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isHexCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isOctCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_") return false;
  for (; index < max; index++) {
    ch = data[index];
    if (ch === "_") continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_") return false;
  return true;
}
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-") sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0") return 0;
  if (ch === "0") {
    if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
var int = new type("tag:yaml.org,2002:int", {
  kind: "scalar",
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  represent: {
    binary: function(obj) {
      return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
    },
    octal: function(obj) {
      return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
    },
    decimal: function(obj) {
      return obj.toString(10);
    },
    /* eslint-disable max-len */
    hexadecimal: function(obj) {
      return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
    }
  },
  defaultStyle: "decimal",
  styleAliases: {
    binary: [2, "bin"],
    octal: [8, "oct"],
    decimal: [10, "dec"],
    hexadecimal: [16, "hex"]
  }
});
var YAML_FLOAT_PATTERN = new RegExp(
  // 2.5e4, 2.5 and integers
  "^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
);
function resolveYamlFloat(data) {
  if (data === null) return false;
  if (!YAML_FLOAT_PATTERN.test(data) || // Quick hack to not allow integers end with `_`
  // Probably should update regexp & check speed
  data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
var float = new type("tag:yaml.org,2002:float", {
  kind: "scalar",
  resolve: resolveYamlFloat,
  construct: constructYamlFloat,
  predicate: isFloat,
  represent: representYamlFloat,
  defaultStyle: "lowercase"
});
var json = failsafe.extend({
  implicit: [
    _null,
    bool,
    int,
    float
  ]
});
var core = json;
var YAML_DATE_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
);
var YAML_TIMESTAMP_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
);
function resolveYamlTimestamp(data) {
  if (data === null) return false;
  if (YAML_DATE_REGEXP.exec(data) !== null) return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
  return false;
}
function constructYamlTimestamp(data) {
  var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match = YAML_DATE_REGEXP.exec(data);
  if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match === null) throw new Error("Date resolve error");
  year = +match[1];
  month = +match[2] - 1;
  day = +match[3];
  if (!match[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match[4];
  minute = +match[5];
  second = +match[6];
  if (match[7]) {
    fraction = match[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match[9]) {
    tz_hour = +match[10];
    tz_minute = +(match[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 6e4;
    if (match[9] === "-") delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta) date.setTime(date.getTime() - delta);
  return date;
}
function representYamlTimestamp(object) {
  return object.toISOString();
}
var timestamp = new type("tag:yaml.org,2002:timestamp", {
  kind: "scalar",
  resolve: resolveYamlTimestamp,
  construct: constructYamlTimestamp,
  instanceOf: Date,
  represent: representYamlTimestamp
});
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
var merge = new type("tag:yaml.org,2002:merge", {
  kind: "scalar",
  resolve: resolveYamlMerge
});
var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
function resolveYamlBinary(data) {
  if (data === null) return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64) continue;
    if (code < 0) return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0; idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
var binary = new type("tag:yaml.org,2002:binary", {
  kind: "scalar",
  resolve: resolveYamlBinary,
  construct: constructYamlBinary,
  predicate: isBinary,
  represent: representYamlBinary
});
var _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
var _toString$2 = Object.prototype.toString;
function resolveYamlOmap(data) {
  if (data === null) return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]") return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey) pairHasKey = true;
        else return false;
      }
    }
    if (!pairHasKey) return false;
    if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
    else return false;
  }
  return true;
}
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
var omap = new type("tag:yaml.org,2002:omap", {
  kind: "sequence",
  resolve: resolveYamlOmap,
  construct: constructYamlOmap
});
var _toString$1 = Object.prototype.toString;
function resolveYamlPairs(data) {
  if (data === null) return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]") return false;
    keys = Object.keys(pair);
    if (keys.length !== 1) return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
function constructYamlPairs(data) {
  if (data === null) return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
var pairs = new type("tag:yaml.org,2002:pairs", {
  kind: "sequence",
  resolve: resolveYamlPairs,
  construct: constructYamlPairs
});
var _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
function resolveYamlSet(data) {
  if (data === null) return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null) return false;
    }
  }
  return true;
}
function constructYamlSet(data) {
  return data !== null ? data : {};
}
var set = new type("tag:yaml.org,2002:set", {
  kind: "mapping",
  resolve: resolveYamlSet,
  construct: constructYamlSet
});
var _default = core.extend({
  implicit: [
    timestamp,
    merge
  ],
  explicit: [
    binary,
    omap,
    pairs,
    set
  ]
});
var _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var CHOMPING_CLIP = 1;
var CHOMPING_STRIP = 2;
var CHOMPING_KEEP = 3;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
function is_EOL(c) {
  return c === 10 || c === 13;
}
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
function simpleEscapeSequence(c) {
  return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode(
    (c - 65536 >> 10) + 55296,
    (c - 65536 & 1023) + 56320
  );
}
function setProperty(object, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
  } else {
    object[key] = value;
  }
}
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (i = 0; i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
var i;
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
function generateError(state2, message) {
  var mark = {
    name: state2.filename,
    buffer: state2.input.slice(0, -1),
    // omit trailing \0
    position: state2.position,
    line: state2.line,
    column: state2.position - state2.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
function throwError(state2, message) {
  throw generateError(state2, message);
}
function throwWarning(state2, message) {
  if (state2.onWarning) {
    state2.onWarning.call(null, generateError(state2, message));
  }
}
var directiveHandlers = {
  YAML: function handleYamlDirective(state2, name, args) {
    var match, major, minor;
    if (state2.version !== null) {
      throwError(state2, "duplication of %YAML directive");
    }
    if (args.length !== 1) {
      throwError(state2, "YAML directive accepts exactly one argument");
    }
    match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match === null) {
      throwError(state2, "ill-formed argument of the YAML directive");
    }
    major = parseInt(match[1], 10);
    minor = parseInt(match[2], 10);
    if (major !== 1) {
      throwError(state2, "unacceptable YAML version of the document");
    }
    state2.version = args[0];
    state2.checkLineBreaks = minor < 2;
    if (minor !== 1 && minor !== 2) {
      throwWarning(state2, "unsupported YAML version of the document");
    }
  },
  TAG: function handleTagDirective(state2, name, args) {
    var handle, prefix;
    if (args.length !== 2) {
      throwError(state2, "TAG directive accepts exactly two arguments");
    }
    handle = args[0];
    prefix = args[1];
    if (!PATTERN_TAG_HANDLE.test(handle)) {
      throwError(state2, "ill-formed tag handle (first argument) of the TAG directive");
    }
    if (_hasOwnProperty$1.call(state2.tagMap, handle)) {
      throwError(state2, 'there is a previously declared suffix for "' + handle + '" tag handle');
    }
    if (!PATTERN_TAG_URI.test(prefix)) {
      throwError(state2, "ill-formed tag prefix (second argument) of the TAG directive");
    }
    try {
      prefix = decodeURIComponent(prefix);
    } catch (err) {
      throwError(state2, "tag prefix is malformed: " + prefix);
    }
    state2.tagMap[handle] = prefix;
  }
};
function captureSegment(state2, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state2.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state2, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state2, "the stream contains non-printable characters");
    }
    state2.result += _result;
  }
}
function mergeMappings(state2, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state2, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      setProperty(destination, key, source[key]);
      overridableKeys[key] = true;
    }
  }
}
function storeMappingPair(state2, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state2, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length; index < quantity; index += 1) {
        mergeMappings(state2, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state2, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state2.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state2.line = startLine || state2.line;
      state2.lineStart = startLineStart || state2.lineStart;
      state2.position = startPos || state2.position;
      throwError(state2, "duplicated mapping key");
    }
    setProperty(_result, keyNode, valueNode);
    delete overridableKeys[keyNode];
  }
  return _result;
}
function readLineBreak(state2) {
  var ch;
  ch = state2.input.charCodeAt(state2.position);
  if (ch === 10) {
    state2.position++;
  } else if (ch === 13) {
    state2.position++;
    if (state2.input.charCodeAt(state2.position) === 10) {
      state2.position++;
    }
  } else {
    throwError(state2, "a line break is expected");
  }
  state2.line += 1;
  state2.lineStart = state2.position;
  state2.firstTabInLine = -1;
}
function skipSeparationSpace(state2, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state2.input.charCodeAt(state2.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state2.firstTabInLine === -1) {
        state2.firstTabInLine = state2.position;
      }
      ch = state2.input.charCodeAt(++state2.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state2.input.charCodeAt(++state2.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state2);
      ch = state2.input.charCodeAt(state2.position);
      lineBreaks++;
      state2.lineIndent = 0;
      while (ch === 32) {
        state2.lineIndent++;
        ch = state2.input.charCodeAt(++state2.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state2.lineIndent < checkIndent) {
    throwWarning(state2, "deficient indentation");
  }
  return lineBreaks;
}
function testDocumentSeparator(state2) {
  var _position = state2.position, ch;
  ch = state2.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state2.input.charCodeAt(_position + 1) && ch === state2.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state2.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
function writeFoldedLines(state2, count) {
  if (count === 1) {
    state2.result += " ";
  } else if (count > 1) {
    state2.result += common.repeat("\n", count - 1);
  }
}
function readPlainScalar(state2, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state2.kind, _result = state2.result, ch;
  ch = state2.input.charCodeAt(state2.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state2.input.charCodeAt(state2.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state2.kind = "scalar";
  state2.result = "";
  captureStart = captureEnd = state2.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state2.input.charCodeAt(state2.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state2.input.charCodeAt(state2.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state2.position === state2.lineStart && testDocumentSeparator(state2) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state2.line;
      _lineStart = state2.lineStart;
      _lineIndent = state2.lineIndent;
      skipSeparationSpace(state2, false, -1);
      if (state2.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state2.input.charCodeAt(state2.position);
        continue;
      } else {
        state2.position = captureEnd;
        state2.line = _line;
        state2.lineStart = _lineStart;
        state2.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state2, captureStart, captureEnd, false);
      writeFoldedLines(state2, state2.line - _line);
      captureStart = captureEnd = state2.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state2.position + 1;
    }
    ch = state2.input.charCodeAt(++state2.position);
  }
  captureSegment(state2, captureStart, captureEnd, false);
  if (state2.result) {
    return true;
  }
  state2.kind = _kind;
  state2.result = _result;
  return false;
}
function readSingleQuotedScalar(state2, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state2.input.charCodeAt(state2.position);
  if (ch !== 39) {
    return false;
  }
  state2.kind = "scalar";
  state2.result = "";
  state2.position++;
  captureStart = captureEnd = state2.position;
  while ((ch = state2.input.charCodeAt(state2.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state2, captureStart, state2.position, true);
      ch = state2.input.charCodeAt(++state2.position);
      if (ch === 39) {
        captureStart = state2.position;
        state2.position++;
        captureEnd = state2.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state2, captureStart, captureEnd, true);
      writeFoldedLines(state2, skipSeparationSpace(state2, false, nodeIndent));
      captureStart = captureEnd = state2.position;
    } else if (state2.position === state2.lineStart && testDocumentSeparator(state2)) {
      throwError(state2, "unexpected end of the document within a single quoted scalar");
    } else {
      state2.position++;
      captureEnd = state2.position;
    }
  }
  throwError(state2, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state2, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state2.input.charCodeAt(state2.position);
  if (ch !== 34) {
    return false;
  }
  state2.kind = "scalar";
  state2.result = "";
  state2.position++;
  captureStart = captureEnd = state2.position;
  while ((ch = state2.input.charCodeAt(state2.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state2, captureStart, state2.position, true);
      state2.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state2, captureStart, state2.position, true);
      ch = state2.input.charCodeAt(++state2.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state2, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state2.result += simpleEscapeMap[ch];
        state2.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (; hexLength > 0; hexLength--) {
          ch = state2.input.charCodeAt(++state2.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state2, "expected hexadecimal character");
          }
        }
        state2.result += charFromCodepoint(hexResult);
        state2.position++;
      } else {
        throwError(state2, "unknown escape sequence");
      }
      captureStart = captureEnd = state2.position;
    } else if (is_EOL(ch)) {
      captureSegment(state2, captureStart, captureEnd, true);
      writeFoldedLines(state2, skipSeparationSpace(state2, false, nodeIndent));
      captureStart = captureEnd = state2.position;
    } else if (state2.position === state2.lineStart && testDocumentSeparator(state2)) {
      throwError(state2, "unexpected end of the document within a double quoted scalar");
    } else {
      state2.position++;
      captureEnd = state2.position;
    }
  }
  throwError(state2, "unexpected end of the stream within a double quoted scalar");
}
function readFlowCollection(state2, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state2.tag, _result, _anchor = state2.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = /* @__PURE__ */ Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state2.input.charCodeAt(state2.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state2.anchor !== null) {
    state2.anchorMap[state2.anchor] = _result;
  }
  ch = state2.input.charCodeAt(++state2.position);
  while (ch !== 0) {
    skipSeparationSpace(state2, true, nodeIndent);
    ch = state2.input.charCodeAt(state2.position);
    if (ch === terminator) {
      state2.position++;
      state2.tag = _tag;
      state2.anchor = _anchor;
      state2.kind = isMapping ? "mapping" : "sequence";
      state2.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state2, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state2, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state2.input.charCodeAt(state2.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state2.position++;
        skipSeparationSpace(state2, true, nodeIndent);
      }
    }
    _line = state2.line;
    _lineStart = state2.lineStart;
    _pos = state2.position;
    composeNode(state2, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state2.tag;
    keyNode = state2.result;
    skipSeparationSpace(state2, true, nodeIndent);
    ch = state2.input.charCodeAt(state2.position);
    if ((isExplicitPair || state2.line === _line) && ch === 58) {
      isPair = true;
      ch = state2.input.charCodeAt(++state2.position);
      skipSeparationSpace(state2, true, nodeIndent);
      composeNode(state2, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state2.result;
    }
    if (isMapping) {
      storeMappingPair(state2, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state2, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state2, true, nodeIndent);
    ch = state2.input.charCodeAt(state2.position);
    if (ch === 44) {
      readNext = true;
      ch = state2.input.charCodeAt(++state2.position);
    } else {
      readNext = false;
    }
  }
  throwError(state2, "unexpected end of the stream within a flow collection");
}
function readBlockScalar(state2, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state2.input.charCodeAt(state2.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state2.kind = "scalar";
  state2.result = "";
  while (ch !== 0) {
    ch = state2.input.charCodeAt(++state2.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state2, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state2, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state2, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state2.input.charCodeAt(++state2.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state2.input.charCodeAt(++state2.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state2);
    state2.lineIndent = 0;
    ch = state2.input.charCodeAt(state2.position);
    while ((!detectedIndent || state2.lineIndent < textIndent) && ch === 32) {
      state2.lineIndent++;
      ch = state2.input.charCodeAt(++state2.position);
    }
    if (!detectedIndent && state2.lineIndent > textIndent) {
      textIndent = state2.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state2.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state2.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state2.result += "\n";
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state2.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state2.result += common.repeat("\n", emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state2.result += " ";
        }
      } else {
        state2.result += common.repeat("\n", emptyLines);
      }
    } else {
      state2.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state2.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state2.input.charCodeAt(++state2.position);
    }
    captureSegment(state2, captureStart, state2.position, false);
  }
  return true;
}
function readBlockSequence(state2, nodeIndent) {
  var _line, _tag = state2.tag, _anchor = state2.anchor, _result = [], following, detected = false, ch;
  if (state2.firstTabInLine !== -1) return false;
  if (state2.anchor !== null) {
    state2.anchorMap[state2.anchor] = _result;
  }
  ch = state2.input.charCodeAt(state2.position);
  while (ch !== 0) {
    if (state2.firstTabInLine !== -1) {
      state2.position = state2.firstTabInLine;
      throwError(state2, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state2.input.charCodeAt(state2.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state2.position++;
    if (skipSeparationSpace(state2, true, -1)) {
      if (state2.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state2.input.charCodeAt(state2.position);
        continue;
      }
    }
    _line = state2.line;
    composeNode(state2, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state2.result);
    skipSeparationSpace(state2, true, -1);
    ch = state2.input.charCodeAt(state2.position);
    if ((state2.line === _line || state2.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state2, "bad indentation of a sequence entry");
    } else if (state2.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state2.tag = _tag;
    state2.anchor = _anchor;
    state2.kind = "sequence";
    state2.result = _result;
    return true;
  }
  return false;
}
function readBlockMapping(state2, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state2.tag, _anchor = state2.anchor, _result = {}, overridableKeys = /* @__PURE__ */ Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state2.firstTabInLine !== -1) return false;
  if (state2.anchor !== null) {
    state2.anchorMap[state2.anchor] = _result;
  }
  ch = state2.input.charCodeAt(state2.position);
  while (ch !== 0) {
    if (!atExplicitKey && state2.firstTabInLine !== -1) {
      state2.position = state2.firstTabInLine;
      throwError(state2, "tab characters must not be used in indentation");
    }
    following = state2.input.charCodeAt(state2.position + 1);
    _line = state2.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state2, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state2, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state2.position += 1;
      ch = following;
    } else {
      _keyLine = state2.line;
      _keyLineStart = state2.lineStart;
      _keyPos = state2.position;
      if (!composeNode(state2, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state2.line === _line) {
        ch = state2.input.charCodeAt(state2.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state2.input.charCodeAt(++state2.position);
        }
        if (ch === 58) {
          ch = state2.input.charCodeAt(++state2.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state2, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state2, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state2.tag;
          keyNode = state2.result;
        } else if (detected) {
          throwError(state2, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state2.tag = _tag;
          state2.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state2, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state2.tag = _tag;
        state2.anchor = _anchor;
        return true;
      }
    }
    if (state2.line === _line || state2.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state2.line;
        _keyLineStart = state2.lineStart;
        _keyPos = state2.position;
      }
      if (composeNode(state2, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state2.result;
        } else {
          valueNode = state2.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state2, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state2, true, -1);
      ch = state2.input.charCodeAt(state2.position);
    }
    if ((state2.line === _line || state2.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state2, "bad indentation of a mapping entry");
    } else if (state2.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state2, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state2.tag = _tag;
    state2.anchor = _anchor;
    state2.kind = "mapping";
    state2.result = _result;
  }
  return detected;
}
function readTagProperty(state2) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state2.input.charCodeAt(state2.position);
  if (ch !== 33) return false;
  if (state2.tag !== null) {
    throwError(state2, "duplication of a tag property");
  }
  ch = state2.input.charCodeAt(++state2.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state2.input.charCodeAt(++state2.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state2.input.charCodeAt(++state2.position);
  } else {
    tagHandle = "!";
  }
  _position = state2.position;
  if (isVerbatim) {
    do {
      ch = state2.input.charCodeAt(++state2.position);
    } while (ch !== 0 && ch !== 62);
    if (state2.position < state2.length) {
      tagName = state2.input.slice(_position, state2.position);
      ch = state2.input.charCodeAt(++state2.position);
    } else {
      throwError(state2, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state2.input.slice(_position - 1, state2.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state2, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state2.position + 1;
        } else {
          throwError(state2, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state2.input.charCodeAt(++state2.position);
    }
    tagName = state2.input.slice(_position, state2.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state2, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state2, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state2, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state2.tag = tagName;
  } else if (_hasOwnProperty$1.call(state2.tagMap, tagHandle)) {
    state2.tag = state2.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state2.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state2.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state2, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
function readAnchorProperty(state2) {
  var _position, ch;
  ch = state2.input.charCodeAt(state2.position);
  if (ch !== 38) return false;
  if (state2.anchor !== null) {
    throwError(state2, "duplication of an anchor property");
  }
  ch = state2.input.charCodeAt(++state2.position);
  _position = state2.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state2.input.charCodeAt(++state2.position);
  }
  if (state2.position === _position) {
    throwError(state2, "name of an anchor node must contain at least one character");
  }
  state2.anchor = state2.input.slice(_position, state2.position);
  return true;
}
function readAlias(state2) {
  var _position, alias, ch;
  ch = state2.input.charCodeAt(state2.position);
  if (ch !== 42) return false;
  ch = state2.input.charCodeAt(++state2.position);
  _position = state2.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state2.input.charCodeAt(++state2.position);
  }
  if (state2.position === _position) {
    throwError(state2, "name of an alias node must contain at least one character");
  }
  alias = state2.input.slice(_position, state2.position);
  if (!_hasOwnProperty$1.call(state2.anchorMap, alias)) {
    throwError(state2, 'unidentified alias "' + alias + '"');
  }
  state2.result = state2.anchorMap[alias];
  skipSeparationSpace(state2, true, -1);
  return true;
}
function composeNode(state2, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state2.listener !== null) {
    state2.listener("open", state2);
  }
  state2.tag = null;
  state2.anchor = null;
  state2.kind = null;
  state2.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state2, true, -1)) {
      atNewLine = true;
      if (state2.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state2.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state2.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state2) || readAnchorProperty(state2)) {
      if (skipSeparationSpace(state2, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state2.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state2.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state2.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state2.position - state2.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state2, blockIndent) || readBlockMapping(state2, blockIndent, flowIndent)) || readFlowCollection(state2, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state2, flowIndent) || readSingleQuotedScalar(state2, flowIndent) || readDoubleQuotedScalar(state2, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state2)) {
          hasContent = true;
          if (state2.tag !== null || state2.anchor !== null) {
            throwError(state2, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state2, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state2.tag === null) {
            state2.tag = "?";
          }
        }
        if (state2.anchor !== null) {
          state2.anchorMap[state2.anchor] = state2.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state2, blockIndent);
    }
  }
  if (state2.tag === null) {
    if (state2.anchor !== null) {
      state2.anchorMap[state2.anchor] = state2.result;
    }
  } else if (state2.tag === "?") {
    if (state2.result !== null && state2.kind !== "scalar") {
      throwError(state2, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state2.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state2.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state2.implicitTypes[typeIndex];
      if (type2.resolve(state2.result)) {
        state2.result = type2.construct(state2.result);
        state2.tag = type2.tag;
        if (state2.anchor !== null) {
          state2.anchorMap[state2.anchor] = state2.result;
        }
        break;
      }
    }
  } else if (state2.tag !== "!") {
    if (_hasOwnProperty$1.call(state2.typeMap[state2.kind || "fallback"], state2.tag)) {
      type2 = state2.typeMap[state2.kind || "fallback"][state2.tag];
    } else {
      type2 = null;
      typeList = state2.typeMap.multi[state2.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
        if (state2.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state2, "unknown tag !<" + state2.tag + ">");
    }
    if (state2.result !== null && type2.kind !== state2.kind) {
      throwError(state2, "unacceptable node kind for !<" + state2.tag + '> tag; it should be "' + type2.kind + '", not "' + state2.kind + '"');
    }
    if (!type2.resolve(state2.result, state2.tag)) {
      throwError(state2, "cannot resolve a node with !<" + state2.tag + "> explicit tag");
    } else {
      state2.result = type2.construct(state2.result, state2.tag);
      if (state2.anchor !== null) {
        state2.anchorMap[state2.anchor] = state2.result;
      }
    }
  }
  if (state2.listener !== null) {
    state2.listener("close", state2);
  }
  return state2.tag !== null || state2.anchor !== null || hasContent;
}
function readDocument(state2) {
  var documentStart = state2.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state2.version = null;
  state2.checkLineBreaks = state2.legacy;
  state2.tagMap = /* @__PURE__ */ Object.create(null);
  state2.anchorMap = /* @__PURE__ */ Object.create(null);
  while ((ch = state2.input.charCodeAt(state2.position)) !== 0) {
    skipSeparationSpace(state2, true, -1);
    ch = state2.input.charCodeAt(state2.position);
    if (state2.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state2.input.charCodeAt(++state2.position);
    _position = state2.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state2.input.charCodeAt(++state2.position);
    }
    directiveName = state2.input.slice(_position, state2.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state2, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state2.input.charCodeAt(++state2.position);
      }
      if (ch === 35) {
        do {
          ch = state2.input.charCodeAt(++state2.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch)) break;
      _position = state2.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state2.input.charCodeAt(++state2.position);
      }
      directiveArgs.push(state2.input.slice(_position, state2.position));
    }
    if (ch !== 0) readLineBreak(state2);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state2, directiveName, directiveArgs);
    } else {
      throwWarning(state2, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state2, true, -1);
  if (state2.lineIndent === 0 && state2.input.charCodeAt(state2.position) === 45 && state2.input.charCodeAt(state2.position + 1) === 45 && state2.input.charCodeAt(state2.position + 2) === 45) {
    state2.position += 3;
    skipSeparationSpace(state2, true, -1);
  } else if (hasDirectives) {
    throwError(state2, "directives end mark is expected");
  }
  composeNode(state2, state2.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state2, true, -1);
  if (state2.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state2.input.slice(documentStart, state2.position))) {
    throwWarning(state2, "non-ASCII line breaks are interpreted as content");
  }
  state2.documents.push(state2.result);
  if (state2.position === state2.lineStart && testDocumentSeparator(state2)) {
    if (state2.input.charCodeAt(state2.position) === 46) {
      state2.position += 3;
      skipSeparationSpace(state2, true, -1);
    }
    return;
  }
  if (state2.position < state2.length - 1) {
    throwError(state2, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += "\n";
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state2 = new State$1(input, options);
  var nullpos = input.indexOf("\0");
  if (nullpos !== -1) {
    state2.position = nullpos;
    throwError(state2, "null byte is not allowed in input");
  }
  state2.input += "\0";
  while (state2.input.charCodeAt(state2.position) === 32) {
    state2.lineIndent += 1;
    state2.position += 1;
  }
  while (state2.position < state2.length - 1) {
    readDocument(state2);
  }
  return state2.documents;
}
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length; index < length; index += 1) {
    iterator(documents[index]);
  }
}
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return void 0;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
var loadAll_1 = loadAll$1;
var load_1 = load$1;
var loader = {
  loadAll: loadAll_1,
  load: load_1
};
var _toString = Object.prototype.toString;
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var CHAR_BOM = 65279;
var CHAR_TAB = 9;
var CHAR_LINE_FEED = 10;
var CHAR_CARRIAGE_RETURN = 13;
var CHAR_SPACE = 32;
var CHAR_EXCLAMATION = 33;
var CHAR_DOUBLE_QUOTE = 34;
var CHAR_SHARP = 35;
var CHAR_PERCENT = 37;
var CHAR_AMPERSAND = 38;
var CHAR_SINGLE_QUOTE = 39;
var CHAR_ASTERISK = 42;
var CHAR_COMMA = 44;
var CHAR_MINUS = 45;
var CHAR_COLON = 58;
var CHAR_EQUALS = 61;
var CHAR_GREATER_THAN = 62;
var CHAR_QUESTION = 63;
var CHAR_COMMERCIAL_AT = 64;
var CHAR_LEFT_SQUARE_BRACKET = 91;
var CHAR_RIGHT_SQUARE_BRACKET = 93;
var CHAR_GRAVE_ACCENT = 96;
var CHAR_LEFT_CURLY_BRACKET = 123;
var CHAR_VERTICAL_LINE = 124;
var CHAR_RIGHT_CURLY_BRACKET = 125;
var ESCAPE_SEQUENCES = {};
ESCAPE_SEQUENCES[0] = "\\0";
ESCAPE_SEQUENCES[7] = "\\a";
ESCAPE_SEQUENCES[8] = "\\b";
ESCAPE_SEQUENCES[9] = "\\t";
ESCAPE_SEQUENCES[10] = "\\n";
ESCAPE_SEQUENCES[11] = "\\v";
ESCAPE_SEQUENCES[12] = "\\f";
ESCAPE_SEQUENCES[13] = "\\r";
ESCAPE_SEQUENCES[27] = "\\e";
ESCAPE_SEQUENCES[34] = '\\"';
ESCAPE_SEQUENCES[92] = "\\\\";
ESCAPE_SEQUENCES[133] = "\\N";
ESCAPE_SEQUENCES[160] = "\\_";
ESCAPE_SEQUENCES[8232] = "\\L";
ESCAPE_SEQUENCES[8233] = "\\P";
var DEPRECATED_BOOLEANS_SYNTAX = [
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null) return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length; index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
var QUOTING_TYPE_SINGLE = 1;
var QUOTING_TYPE_DOUBLE = 2;
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf("\n", position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== "\n") result += ind;
    result += line;
  }
  return result;
}
function generateNextLine(state2, level) {
  return "\n" + common.repeat(" ", state2.indent * level);
}
function testImplicitResolving(state2, str2) {
  var index, length, type2;
  for (index = 0, length = state2.implicitTypes.length; index < length; index += 1) {
    type2 = state2.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (
    // ns-plain-safe
    (inblock ? (
      // c = flow-in
      cIsNsCharOrWhitespace
    ) : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar
  );
}
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
var STYLE_PLAIN = 1;
var STYLE_SINGLE = 2;
var STYLE_LITERAL = 3;
var STYLE_FOLDED = 4;
var STYLE_DOUBLE = 5;
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
          i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
function writeScalar(state2, string, level, iskey, inblock) {
  state2.dump = (function() {
    if (string.length === 0) {
      return state2.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state2.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state2.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state2.indent * Math.max(1, level);
    var lineWidth = state2.lineWidth === -1 ? -1 : Math.max(Math.min(state2.lineWidth, 40), state2.lineWidth - indent);
    var singleLineOnly = iskey || state2.flowLevel > -1 && level >= state2.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state2, string2);
    }
    switch (chooseScalarStyle(
      string,
      singleLineOnly,
      state2.indent,
      lineWidth,
      testAmbiguity,
      state2.quotingType,
      state2.forceQuotes && !iskey,
      inblock
    )) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state2.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state2.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  })();
}
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === "\n";
  var keep = clip && (string[string.length - 2] === "\n" || string === "\n");
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + "\n";
}
function dropEndingNewline(string) {
  return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
}
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = (function() {
    var nextLF = string.indexOf("\n");
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  })();
  var prevMoreIndented = string[0] === "\n" || string[0] === " ";
  var moreIndented;
  var match;
  while (match = lineRe.exec(string)) {
    var prefix = match[1], line = match[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
function foldLine(line, width) {
  if (line === "" || line[0] === " ") return line;
  var breakRe = / [^ ]/g;
  var match;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match = breakRe.exec(line)) {
    next = match.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += "\n" + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += "\n";
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
    char = codePointAt(string, i);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i];
      if (char >= 65536) result += string[i + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
function writeFlowSequence(state2, level, object) {
  var _result = "", _tag = state2.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state2.replacer) {
      value = state2.replacer.call(object, String(index), value);
    }
    if (writeNode(state2, level, value, false, false) || typeof value === "undefined" && writeNode(state2, level, null, false, false)) {
      if (_result !== "") _result += "," + (!state2.condenseFlow ? " " : "");
      _result += state2.dump;
    }
  }
  state2.tag = _tag;
  state2.dump = "[" + _result + "]";
}
function writeBlockSequence(state2, level, object, compact) {
  var _result = "", _tag = state2.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state2.replacer) {
      value = state2.replacer.call(object, String(index), value);
    }
    if (writeNode(state2, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state2, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state2, level);
      }
      if (state2.dump && CHAR_LINE_FEED === state2.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state2.dump;
    }
  }
  state2.tag = _tag;
  state2.dump = _result || "[]";
}
function writeFlowMapping(state2, level, object) {
  var _result = "", _tag = state2.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "") pairBuffer += ", ";
    if (state2.condenseFlow) pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state2.replacer) {
      objectValue = state2.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state2, level, objectKey, false, false)) {
      continue;
    }
    if (state2.dump.length > 1024) pairBuffer += "? ";
    pairBuffer += state2.dump + (state2.condenseFlow ? '"' : "") + ":" + (state2.condenseFlow ? "" : " ");
    if (!writeNode(state2, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state2.dump;
    _result += pairBuffer;
  }
  state2.tag = _tag;
  state2.dump = "{" + _result + "}";
}
function writeBlockMapping(state2, level, object, compact) {
  var _result = "", _tag = state2.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state2.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state2.sortKeys === "function") {
    objectKeyList.sort(state2.sortKeys);
  } else if (state2.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state2, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state2.replacer) {
      objectValue = state2.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state2, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state2.tag !== null && state2.tag !== "?" || state2.dump && state2.dump.length > 1024;
    if (explicitPair) {
      if (state2.dump && CHAR_LINE_FEED === state2.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state2.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state2, level);
    }
    if (!writeNode(state2, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state2.dump && CHAR_LINE_FEED === state2.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state2.dump;
    _result += pairBuffer;
  }
  state2.tag = _tag;
  state2.dump = _result || "{}";
}
function detectType(state2, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state2.explicitTypes : state2.implicitTypes;
  for (index = 0, length = typeList.length; index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state2.tag = type2.representName(object);
        } else {
          state2.tag = type2.tag;
        }
      } else {
        state2.tag = "?";
      }
      if (type2.represent) {
        style = state2.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state2.dump = _result;
      }
      return true;
    }
  }
  return false;
}
function writeNode(state2, level, object, block, compact, iskey, isblockseq) {
  state2.tag = null;
  state2.dump = object;
  if (!detectType(state2, object, false)) {
    detectType(state2, object, true);
  }
  var type2 = _toString.call(state2.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state2.flowLevel < 0 || state2.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state2.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state2.tag !== null && state2.tag !== "?" || duplicate || state2.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state2.usedDuplicates[duplicateIndex]) {
    state2.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state2.usedDuplicates[duplicateIndex]) {
      state2.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state2.dump).length !== 0) {
        writeBlockMapping(state2, level, state2.dump, compact);
        if (duplicate) {
          state2.dump = "&ref_" + duplicateIndex + state2.dump;
        }
      } else {
        writeFlowMapping(state2, level, state2.dump);
        if (duplicate) {
          state2.dump = "&ref_" + duplicateIndex + " " + state2.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state2.dump.length !== 0) {
        if (state2.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state2, level - 1, state2.dump, compact);
        } else {
          writeBlockSequence(state2, level, state2.dump, compact);
        }
        if (duplicate) {
          state2.dump = "&ref_" + duplicateIndex + state2.dump;
        }
      } else {
        writeFlowSequence(state2, level, state2.dump);
        if (duplicate) {
          state2.dump = "&ref_" + duplicateIndex + " " + state2.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state2.tag !== "?") {
        writeScalar(state2, state2.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state2.skipInvalid) return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state2.tag !== null && state2.tag !== "?") {
      tagStr = encodeURI(
        state2.tag[0] === "!" ? state2.tag.slice(1) : state2.tag
      ).replace(/!/g, "%21");
      if (state2.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state2.dump = tagStr + " " + state2.dump;
    }
  }
  return true;
}
function getDuplicateReferences(object, state2) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) {
    state2.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state2.usedDuplicates = new Array(length);
}
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length; index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length; index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
function dump$1(input, options) {
  options = options || {};
  var state2 = new State(options);
  if (!state2.noRefs) getDuplicateReferences(input, state2);
  var value = input;
  if (state2.replacer) {
    value = state2.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state2, 0, value, true, true)) return state2.dump + "\n";
  return "";
}
var dump_1 = dump$1;
var dumper = {
  dump: dump_1
};
function renamed(from, to) {
  return function() {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
  };
}
var load = loader.load;
var loadAll = loader.loadAll;
var dump = dumper.dump;
var safeLoad = renamed("safeLoad", "load");
var safeLoadAll = renamed("safeLoadAll", "loadAll");
var safeDump = renamed("safeDump", "dump");

// runtime/src/app.ts
var state = {
  manifest: null,
  selected: null,
  webcontainers: /* @__PURE__ */ new Map(),
  frontendProcesses: /* @__PURE__ */ new Map(),
  databases: /* @__PURE__ */ new Map(),
  databaseHandles: /* @__PURE__ */ new Map(),
  runtimeWorkerRegistration: null,
  mockRoutes: /* @__PURE__ */ new Map(),
  databaseBridgeListening: false,
  frontendBridgeListening: false
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
var CDN = {
  webcontainer: "https://esm.sh/@webcontainer/api@1",
  pglite: "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2/dist/index.js",
  wasmer: "https://unpkg.com/@wasmer/sdk@0.10.0/dist/index.mjs",
  sqlJsBase: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3"
};
var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
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
  return parts.filter(Boolean).join(" \xB7 ");
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
      frontendBridgeOptions(state.manifest?.services || [])
    ));
  }
  if (state.frontendProcesses.has(service.name)) {
    log("Frontend dev server is already running.");
    return;
  }
  const env = frontendServiceEnvironment(
    frontendEnvironment(service.config.env || {}),
    state.manifest?.services || [],
    window.location.href
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
    }
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
    log
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
    throw new Error("mock-http and browser-database demos use a service worker, which does not run from file://. Serve the demo over http(s) \u2014 e.g. run `npx serve` inside the demo folder. See docs/HOSTING.md.");
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
  return services.some((service) => service.adapter === "mock-http") || databaseServices(services).length > 0;
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
        response
      }, "*");
    } catch (error) {
      event.source?.postMessage({
        type: "POCKETSTACK_BRIDGE_RESPONSE",
        id: event.data.id,
        ok: false,
        error: error.message || String(error)
      }, "*");
    }
  });
}
async function fetchFrontendBridgeTarget(request) {
  const target = frontendBridgeTargetURL(request.url);
  if (!target) throw new Error(`PocketStack bridge cannot proxy ${request.url}`);
  await ensureRuntimeServicesRegistered();
  const method = request.method || "GET";
  const init2 = {
    method,
    headers: request.headers || []
  };
  if (method !== "GET" && method !== "HEAD") init2.body = request.body || "";
  const response = await fetch(target, init2);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body: await response.text()
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
  const service = (state.manifest?.services || []).find((item) => item.name === url.hostname && frontendBridgePortMatches(url, item));
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
  if (!service || service.adapter !== "postgres-pglite" && service.adapter !== "sqlite") {
    throw new Error(`database service ${name} is not available`);
  }
  const query = service.adapter === "postgres-pglite" ? await startPGlite(service, { render: false }) : await startSQLite(service, { render: false });
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
    loadFixtureRoutes(service)
  ]);
  return mergeMockRoutes(openAPIRoutes, fixtureRoutes);
}
async function loadOpenAPIRoutes(service) {
  const openAPIPath = service.config.openapiPath;
  if (!openAPIPath) return [];
  const raw = await fetchText(openAPIPath);
  const document2 = await parseOpenAPI(raw, openAPIPath);
  const routes = routesFromOpenAPIDocument(document2);
  log(`Loaded ${routes.length} OpenAPI route(s).`, "mock");
  return routes;
}
async function parseOpenAPI(raw, path) {
  const trimmed = raw.trim();
  if (path.endsWith(".json") || trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  return load(raw);
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
      path: payload.path || `/${file.replace(/\.json$/, "")}`
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
    const query2 = state.databases.get(service.name);
    if (render) renderQueryPanel(service, query2);
    return query2;
  }
  const { PGlite } = await importModule(CDN.pglite, "PGlite");
  const db = new PGlite(pgliteDataDir(service));
  const bootstrapped = await ensurePGliteBootstrapped(db, () => executeSQLAssets(db, service), log);
  if (!bootstrapped) log("Loaded persisted PGlite database.");
  log("PGlite database initialized.");
  const query = async (sql) => {
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
    const query2 = state.databases.get(service.name);
    if (render) renderQueryPanel(service, query2);
    return query2;
  }
  try {
    await loadScript(`${CDN.sqlJsBase}/sql-wasm.js`);
  } catch {
    throw new Error(`Could not load sql.js from ${CDN.sqlJsBase}. This demo needs network access to that CDN and cannot run offline.`);
  }
  const SQL = await window.initSqlJs({
    locateFile: (file) => `${CDN.sqlJsBase}/${file}`
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
    services: state.manifest.services
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
export {
  splitCommand
};
/*! Bundled license information:

js-yaml/dist/js-yaml.mjs:
  (*! js-yaml 4.1.1 https://github.com/nodeca/js-yaml @license MIT *)
*/
