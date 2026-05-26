const HTTP_METHODS = new Set(["get", "put", "post", "delete", "patch", "options", "head"]);

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

function resolvePointer(document, pointer) {
  if (!pointer?.startsWith("#/")) return undefined;
  return pointer
    .slice(2)
    .split("/")
    .reduce((cursor, segment) => {
      if (cursor === undefined || cursor === null) return undefined;
      const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      return cursor[key];
    }, document);
}

function resolveRef(value, document, seen = new Set()) {
  if (!value || typeof value !== "object" || !value.$ref) return value;
  if (seen.has(value.$ref)) return {};
  seen.add(value.$ref);
  const resolved = resolvePointer(document, value.$ref);
  return resolveRef(resolved || {}, document, seen);
}

function chooseContent(response = {}) {
  const content = response.content || {};
  const entries = Object.entries(content);
  const ranked = entries
    .map(([contentType, value]) => [contentType, value, contentRank(contentType)])
    .sort((left, right) => right[2] - left[2]);
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

function firstExample(examples = {}, document) {
  const first = resolveRef(examples[Object.keys(examples)[0]], document);
  if (!first) return undefined;
  if (Object.prototype.hasOwnProperty.call(first, "value")) return first.value;
  return first;
}

function exampleFromSchema(schema = {}, fallback, document, seen = new Set()) {
  schema = resolveRef(schema, document, seen);
  if (Object.prototype.hasOwnProperty.call(schema, "example")) return schema.example;
  if (Object.prototype.hasOwnProperty.call(schema, "default")) return schema.default;
  if (schema.enum?.length) return schema.enum[0];

  if (schema.oneOf?.length || schema.anyOf?.length) {
    return exampleFromSchema(schema.oneOf?.[0] || schema.anyOf?.[0], fallback, document, seen);
  }
  if (schema.allOf?.length) {
    return schema.allOf.reduce((merged, item) => {
      const value = exampleFromSchema(item, fallback, document, seen);
      if (value && typeof value === "object" && !Array.isArray(value) && merged && typeof merged === "object" && !Array.isArray(merged)) {
        return { ...merged, ...value };
      }
      return value;
    }, {});
  }

  switch (schema.type) {
    case "string":
      return schema.format === "date-time" ? "2026-05-26T00:00:00Z" : "string";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return true;
    case "array":
      return [exampleFromSchema(schema.items || {}, fallback, document, seen)];
    case "object": {
      const result = {};
      for (const [name, property] of Object.entries(schema.properties || {})) {
        result[name] = exampleFromSchema(property, fallback, document, seen);
      }
      return result;
    }
    default:
      return fallback;
  }
}

function responseBodyFor(method, path, content, document) {
  content = resolveRef(content, document);
  if (Object.prototype.hasOwnProperty.call(content, "example")) return content.example;
  const fromExamples = firstExample(content.examples, document);
  if (fromExamples !== undefined) return fromExamples;
  return exampleFromSchema(content.schema, {
    mock: true,
    method: method.toUpperCase(),
    path,
  }, document);
}

function responseHeaders(response = {}, contentType, document) {
  const headers = {};
  for (const [name, rawHeader] of Object.entries(response.headers || {})) {
    const header = resolveRef(rawHeader, document);
    const value = headerValue(header, document);
    if (value !== undefined) headers[name] = String(value);
  }
  if (contentType) headers["content-type"] = contentType;
  return headers;
}

function headerValue(header = {}, document) {
  if (Object.prototype.hasOwnProperty.call(header, "example")) return header.example;
  const fromExamples = firstExample(header.examples, document);
  if (fromExamples !== undefined) return fromExamples;
  return exampleFromSchema(header.schema, undefined, document);
}

function routeFromOperation(path, method, operation = {}, document, pathItem = {}) {
  operation = resolveRef(operation, document);
  const [statusKey, rawResponse] = chooseResponse(operation.responses || {});
  const status = statusFromKey(statusKey);
  const response = resolveRef(rawResponse, document);
  const bodyAllowed = responseAllowsBody(method, status);
  const [contentType, content] = bodyAllowed ? chooseContent(response) : ["", {}];
  const body = bodyAllowed ? responseBodyFor(method, path, content, document) : undefined;
  const headers = responseHeaders(response, bodyAllowed ? contentType : "", document);
  const query = queryFromParameters(mergedParameters(pathItem.parameters, operation.parameters, document), document);
  const route = {
    method: method.toUpperCase(),
    path: path.startsWith("/") ? path : `/${path}`,
    ...(query ? { query } : {}),
    status,
    ...(Object.keys(headers).length ? { headers } : {}),
    source: "openapi",
  };
  if (bodyAllowed) route.body = body;
  return route;
}

function mergedParameters(pathParameters = [], operationParameters = [], document) {
  const byKey = new Map();
  for (const rawParameter of pathParameters || []) {
    const parameter = resolveRef(rawParameter, document);
    if (parameter?.in && parameter?.name) byKey.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  for (const rawParameter of operationParameters || []) {
    const parameter = resolveRef(rawParameter, document);
    if (parameter?.in && parameter?.name) byKey.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...byKey.values()];
}

function queryFromParameters(parameters = [], document) {
  const search = new URLSearchParams();
  for (const parameter of parameters) {
    if (parameter.in !== "query" || !parameter.required) continue;
    const value = parameterExample(parameter, document);
    if (value === undefined) continue;
    search.set(parameter.name, String(value));
  }
  return search.toString();
}

function parameterExample(parameter = {}, document) {
  parameter = resolveRef(parameter, document);
  if (Object.prototype.hasOwnProperty.call(parameter, "example")) return parameter.example;
  const fromExamples = firstExample(parameter.examples, document);
  if (fromExamples !== undefined) return fromExamples;
  return exampleFromSchema(parameter.schema, undefined, document);
}

function keyFor(route) {
  return `${route.method.toUpperCase()} ${route.path}${route.query ? `?${route.query}` : ""}`;
}

function splitRoutePath(rawPath = "") {
  const [pathPart, query = ""] = String(rawPath || "").split("?");
  return {
    path: pathPart.startsWith("/") ? pathPart : `/${pathPart}`,
    query,
  };
}

function normalizeFixtureRoute(route) {
  const path = splitRoutePath(route.path || "");
  const status = typeof route.status === "number" ? route.status : statusFromKey(route.status || "200");
  const method = (route.method || "GET").toUpperCase();
  const bodyAllowed = responseAllowsBody(method, status);
  const body =
    route.body !== undefined
      ? { body: route.body }
      : route.bodyFrom
        ? {}
        : { body: route };
  const normalized = {
    method,
    path: path.path,
    ...(path.query ? { query: path.query } : {}),
    status,
    headers: route.headers || (bodyAllowed ? { "content-type": "application/json" } : {}),
    ...(bodyAllowed && route.bodyFrom ? { bodyFrom: route.bodyFrom } : {}),
    ...(bodyAllowed ? body : {}),
    source: route.source || "fixture",
  };
  if (!Object.keys(normalized.headers).length) delete normalized.headers;
  return normalized;
}

function routesFromOpenAPIDocument(document) {
  const routes = [];
  const paths = document?.paths || {};
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = resolveRef(rawPathItem, document);
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      routes.push(routeFromOperation(path, method, operation, document, pathItem));
    }
  }
  return routes;
}

function mergeMockRoutes(openAPIRoutes = [], fixtureRoutes = []) {
  const byKey = new Map();
  for (const route of openAPIRoutes) byKey.set(keyFor(route), route);
  for (const route of fixtureRoutes.map(normalizeFixtureRoute)) byKey.set(keyFor(route), route);
  return [...byKey.values()];
}

export { mergeMockRoutes, normalizeFixtureRoute, parameterExample, queryFromParameters, resolvePointer, responseAllowsBody, routesFromOpenAPIDocument, splitRoutePath };
