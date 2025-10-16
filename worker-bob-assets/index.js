const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname.startsWith("/models/")) {
      const key = url.pathname.replace("/models/", "");
      const file = await env["bob-animations"].get(key);
      if (!file) return new Response(`Model not found: ${key}`, { status: 404, headers: CORS_HEADERS });
      return new Response(file.body, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "model/gltf-binary",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    return new Response("Bob’s asset worker", { status: 200, headers: CORS_HEADERS });
  },
};
