const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (pathname.startsWith("/models/")) {
      const key = pathname.replace("/models/", "");
      const object = await env["bob-animations"].get(key);
      if (!object) {
        return new Response(`Model not found: ${key}`, {
          status: 404,
          headers: CORS_HEADERS,
        });
      }
      return new Response(object.body, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "model/gltf-binary",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    return new Response("Usage: /models/<filename.glb>", {
      status: 400,
      headers: CORS_HEADERS,
    });
  },
};
