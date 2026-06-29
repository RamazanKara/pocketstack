const TEXT_EXTENSIONS = new Set([
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
  ".yml",
]);

const TEXT_FILENAMES = new Set([
  ".env",
  ".gitignore",
  "dockerfile",
  "license",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const FRONTEND_BRIDGE_FILE = "__pocketstack_bridge.js";

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
  const files = [...(project.files || [])];
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
    let contents = Object.prototype.hasOwnProperty.call(virtualFiles, file)
      ? virtualFiles[file]
      : await readFile(file);
    if (typeof contents === "string" && typeof options.transformTextFile === "function") {
      contents = options.transformTextFile(file, contents);
    }
    cursor[parts.at(-1)] = { file: { contents } };
  }
  return root;
}

function frontendBridgeServices(services = []) {
  return services
    .filter((service) => ["mock-http", "postgres-pglite", "sqlite"].includes(service?.adapter) && service.name)
    .map((service) => ({
      name: service.name,
      adapter: service.adapter,
      publicPort: Number(service.publicPort || 0),
    }));
}

function frontendBridgeOptions(services = []) {
  const bridgeServices = frontendBridgeServices(services);
  if (bridgeServices.length === 0) return {};
  const config = JSON.stringify({ services: bridgeServices });
  return {
    virtualFiles: {
      [FRONTEND_BRIDGE_FILE]: frontendBridgeScript(),
    },
    transformTextFile(file, contents) {
      if (!isHTMLFile(file)) return contents;
      return injectFrontendBridge(contents, config);
    },
  };
}

function isHTMLFile(file = "") {
  return /\.html?$/i.test(file.replaceAll("\\", "/"));
}

function injectFrontendBridge(html, config) {
  if (html.includes(FRONTEND_BRIDGE_FILE)) return html;
  const snippet = `<script>window.__POCKETSTACK_BRIDGE_CONFIG__=${config};</script><script type="module" src="/${FRONTEND_BRIDGE_FILE}"></script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}</head>`);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, `<body$1>${snippet}`);
  return `${snippet}${html}`;
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

export {
  createWebContainerTree,
  frontendBridgeOptions,
  frontendBridgeScript,
  frontendBridgeServices,
  frontendDisplayCommand,
  frontendEnvironment,
  injectFrontendBridge,
  isHTMLFile,
  isTextProjectFile,
  normalizeProjectFile,
  splitCommand,
};
