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
      try {
        const {
          text = "",
          voice = "alloy",
          model = "gpt-4o-mini-tts",
          format = "mp3",
          speed,
        } = await request.json();

        if (!text.trim()) {
          return new Response("Missing text for TTS", {
            status: 400,
            headers: corsHeaders,
          });
        }

        const payload = {
          model,
          voice,
          input: text,
        };

        if (typeof format === "string" && format.trim()) {
          payload.format = format.trim();
        }

        if (typeof speed === "number") {
          payload.speed = Math.max(0.25, Math.min(speed, 4));
        }

        const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!ttsResponse.ok) {
          const errText = await ttsResponse.text();
          return new Response(errText || "TTS request failed", {
            status: ttsResponse.status,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          });
        }

        const contentType =
          ttsResponse.headers.get("content-type") ||
          (payload.format === "wav"
            ? "audio/wav"
            : payload.format === "opus"
            ? "audio/ogg"
            : payload.format === "aac"
            ? "audio/aac"
            : payload.format === "flac"
            ? "audio/flac"
            : "audio/mpeg");

        return new Response(ttsResponse.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
          },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error.message || "TTS request failed" }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
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
