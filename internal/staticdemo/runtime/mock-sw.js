const routesByService = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "POCKETSTACK_ROUTES") return;
  routesByService.set(event.data.service, event.data.routes || []);
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const dbMarker = "/__pocketstack/db/";
  const dbMarkerIndex = url.pathname.indexOf(dbMarker);
  if (dbMarkerIndex >= 0) {
    event.respondWith(handleDatabaseRequest(event.request, url, dbMarkerIndex + dbMarker.length, event.clientId));
    return;
  }

  const marker = "/__pocketstack/mock/";
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex < 0) return;
  const remainder = url.pathname.slice(markerIndex + marker.length);
  const [service, ...rest] = remainder.split("/");
  const path = `/${rest.map((part) => decodeURIComponent(part)).join("/")}`;
  if (event.request.method === "OPTIONS") {
    event.respondWith(new Response(null, {
      status: 204,
      headers: corsHeaders(event.request),
    }));
    return;
  }
  const routes = routesByService.get(decodeURIComponent(service)) || [];
  const match = firstRouteMatch(routes, event.request.method, path, url.searchParams);
  if (!match) {
    event.respondWith(new Response(JSON.stringify({ error: "mock route not found", path, query: Object.fromEntries(url.searchParams) }), {
      status: 404,
      headers: corsHeaders(event.request, { "content-type": "application/json" }),
    }));
    return;
  }
  event.respondWith(mockResponse(event.request, match.route, path, url, match.params));
});

async function handleDatabaseRequest(request, url, offset, clientId = "") {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }
  const remainder = url.pathname.slice(offset);
  const [service, action = ""] = remainder.split("/");
  if (decodeURIComponent(action) !== "query") {
    return jsonResponse(request, { error: "database endpoint not found" }, 404);
  }
  try {
    const sql = await databaseSQLFromRequest(request, url);
    if (!sql.trim()) {
      return jsonResponse(request, { error: "missing SQL query" }, 400);
    }
    const result = await requestDatabaseQuery(decodeURIComponent(service), sql, clientId);
    return jsonResponse(request, { service: decodeURIComponent(service), result });
  } catch (error) {
    return jsonResponse(request, { error: error.message || String(error) }, 500);
  }
}

async function databaseSQLFromRequest(request, url) {
  if (request.method === "GET") return url.searchParams.get("sql") || "";
  const contentType = request.headers?.get?.("content-type") || "";
  const body = await request.text();
  if (contentType.includes("json")) {
    const payload = body ? JSON.parse(body) : {};
    return String(payload.sql || "");
  }
  return body;
}

async function requestDatabaseQuery(service, sql, clientId = "") {
  let client = null;
  if (clientId && self.clients.get) {
    client = await self.clients.get(clientId);
  }
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  client = client || clients.find((candidate) => candidate.id === clientId) || clients[0];
  if (!client) throw new Error("PocketStack dashboard is not available to run database queries");
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (callback, value) => {
      clearTimeout(timeout);
      channel.port1.close?.();
      callback(value);
    };
    const timeout = setTimeout(() => {
      channel.port1.close?.();
      reject(new Error(`database query for ${service} timed out`));
    }, 30_000);
    channel.port1.onmessage = (event) => {
      const data = event.data || {};
      if (data.ok) {
        finish(resolve, data.result);
      } else {
        finish(reject, new Error(data.error || "database query failed"));
      }
    };
    channel.port1.start?.();
    client.postMessage({ type: "POCKETSTACK_DB_QUERY", service, sql }, [channel.port2]);
  });
}

async function mockResponse(request, route, path, url, params = {}) {
  const status = route.status || 200;
  const bodyAllowed = responseAllowsBody(request.method, status);
  const bodyValue = bodyAllowed ? await bodyForRoute(request, route, path, url, params) : undefined;
  const headers = route.headers || (bodyValue === undefined ? {} : { "content-type": "application/json" });
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  const body = bodyValue === undefined
    ? undefined
    : typeof bodyValue === "string" && !contentType.includes("json")
    ? bodyValue
    : JSON.stringify(bodyValue);
  return new Response(body, {
    status,
    headers: corsHeaders(request, headers),
  });
}

function jsonResponse(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request, { "content-type": "application/json" }),
  });
}

function corsHeaders(request, headers = {}) {
  const result = { ...headers };
  const hasHeader = (name) => Object.keys(result).some((key) => key.toLowerCase() === name);
  if (!hasHeader("access-control-allow-origin")) {
    result["access-control-allow-origin"] = "*";
  }
  if (!hasHeader("access-control-allow-methods")) {
    result["access-control-allow-methods"] = "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS";
  }
  if (!hasHeader("access-control-allow-headers")) {
    result["access-control-allow-headers"] = request.headers?.get?.("access-control-request-headers") || "content-type, authorization";
  }
  return result;
}

function responseAllowsBody(method, status) {
  return method.toUpperCase() !== "HEAD" && ![204, 205, 304].includes(status);
}

async function bodyForRoute(request, route, path, url, params = {}) {
  switch (route.bodyFrom) {
    case "request":
      return {
        method: request.method,
        path,
        params,
        query: Object.fromEntries(url.searchParams),
        body: await requestBody(request),
      };
    case "request.params":
      return params;
    case "request.json":
      return requestJSON(request);
    case "request.text":
      return request.text();
    case "request.query":
      return Object.fromEntries(url.searchParams);
    default:
      return route.body;
  }
}

async function requestBody(request) {
  const contentType = request.headers?.get?.("content-type") || "";
  if (contentType.includes("json")) return requestJSON(request);
  const text = await request.text();
  if (!text) return null;
  return text;
}

async function requestJSON(request) {
  const text = await request.text();
  if (!text) return null;
  return JSON.parse(text);
}

function firstRouteMatch(routes, method, path, searchParams = new URLSearchParams()) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = matchRoute(route, path, searchParams);
    if (match.matched) return { route, params: match.params };
  }
  return null;
}

function matchRoute(route, path, searchParams = new URLSearchParams()) {
  const pattern = route?.path;
  if (typeof pattern !== "string") return { matched: false, params: {} };
  if (route.query && !queryMatches(route.query, searchParams)) return { matched: false, params: {} };
  if (pattern === path) return { matched: true, params: {} };
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return { matched: false, params: {} };
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index];
    const value = pathParts[index];
    const parameter = part.match(/^\{([^/]+)\}$/);
    if (parameter) {
      params[parameter[1]] = value;
      continue;
    }
    if (part !== value) return { matched: false, params: {} };
  }
  return { matched: true, params };
}

function queryMatches(expected, actualParams) {
  const expectedParams = new URLSearchParams(expected);
  for (const [key, value] of expectedParams) {
    if (actualParams.get(key) !== value) return false;
  }
  return true;
}
