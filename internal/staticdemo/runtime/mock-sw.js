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
  const marker = "/__pocketstack/mock/";
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex < 0) return;
  const remainder = url.pathname.slice(markerIndex + marker.length);
  const [service, ...rest] = remainder.split("/");
  const path = `/${rest.join("/")}`;
  const routes = routesByService.get(decodeURIComponent(service)) || [];
  const route = routes.find((item) => item.method === event.request.method && item.path === path);
  if (!route) {
    event.respondWith(new Response(JSON.stringify({ error: "mock route not found", path }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }));
    return;
  }
  event.respondWith(new Response(JSON.stringify(route.body), {
    status: route.status || 200,
    headers: route.headers || { "content-type": "application/json" },
  }));
});
