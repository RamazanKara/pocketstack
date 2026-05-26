function serviceEnvName(name = "") {
  return String(name || "service")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "SERVICE";
}

function mockServices(services = []) {
  return services.filter((service) => service?.adapter === "mock-http" && service.name);
}

function databaseServices(services = []) {
  return services.filter((service) => (
    (service?.adapter === "postgres-pglite" || service?.adapter === "sqlite") && service.name
  ));
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
  const service = mockServices(services).find((candidate) => (
    url.hostname === candidate.name && servicePortMatches(url, candidate)
  ));
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

export {
  databaseServiceBaseURL,
  databaseServices,
  frontendBridgeNeeded,
  frontendServiceEnvironment,
  mockServiceBaseURL,
  rewriteMockServiceURL,
  serviceEnvName,
};
