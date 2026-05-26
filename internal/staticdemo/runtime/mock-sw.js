const routesByService = new Map();

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "POCKETSTACK_ROUTES") return;
  routesByService.set(event.data.service, event.data.routes || []);
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith("/__pocketstack/mock/")) return;
  const [, , , service, ...rest] = url.pathname.split("/");
  const path = `/${rest.join("/")}`;
  const routes = routesByService.get(service) || [];
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
