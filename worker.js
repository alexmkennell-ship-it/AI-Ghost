// worker.js

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // === Serve 3D models from R2 bucket ===
    if (url.pathname.startsWith("/models/")) {
      const key = url.pathname.replace("/models/", "");
      const object = await env.BOB_MODELS.get(key);

      if (!object) {
        return new Response("Model not found", {
          status: 404,
          headers: corsHeaders,
        });
      }

      return new Response(object.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "model/gltf-binary",
        },
      });
    }

    // === Handle text-to-speech ===
    if (request.method === "POST" && url.pathname === "/tts") {
      const { text = "", voice = "alloy" } = await request.json();

      if (!text.trim()) {
        return new Response("Missing text for TTS", {
          status: 400,
          headers: corsHeaders,
        });
      }

      const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice,
          input: text,
        }),
      });

      if (!ttsResponse.ok) {
        const errorText = await ttsResponse.text();
        return new Response(errorText || "TTS request failed", {
          status: ttsResponse.status,
          headers: corsHeaders,
        });
      }

      const contentType =
        ttsResponse.headers.get("Content-Type") || "audio/mpeg";

      return new Response(ttsResponse.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
        },
      });
    }

    // === Handle chat messages ===
    if (request.method === "POST" && url.pathname === "/") {
      const body = await request.json();
      const prompt = body.prompt || "";
      const system = "You are Bob, a funny skeleton cowboy ghost who’s mischievous but kind.";

      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          max_tokens: 100,
        }),
      });

      const data = await aiResponse.json();
      const reply = data.choices?.[0]?.message?.content || "…(skeletal silence)…";

      return new Response(JSON.stringify({ reply }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    return new Response("OK", { headers: corsHeaders });
  },
};
