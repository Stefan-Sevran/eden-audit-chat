const assert = require("assert");

const { app } = require("../index");

const routes = app._router.stack
  .filter((layer) => layer.route)
  .map((layer) => ({
    path: layer.route.path,
    methods: layer.route.methods
  }));

function hasRoute(method, path) {
  return routes.some(
    (route) =>
      route.path === path &&
      route.methods[method] === true
  );
}

for (const path of [
  "/audit-chat",
  "/audit-voice-intake",
  "/audit-realtime-call"
]) {
  assert(
    hasRoute("post", path),
    `Missing V2.3.2 route: POST ${path}`
  );
}

for (const path of [
  "/booking-chat",
  "/realtime-call",
  "/voice-booking",
  "/chat",
  "/revenue-receptionist-chat"
]) {
  assert(
    hasRoute("post", path),
    `Existing production route was lost: POST ${path}`
  );
}

assert(
  hasRoute("get", "/live-chat/:sessionId"),
  "Existing live-chat polling route was lost."
);

console.log(
    "V2.3.2c production route registration and Nida route regression checks passed."
);
