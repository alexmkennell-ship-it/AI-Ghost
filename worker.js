// worker.js — Bob the Bone Cowboy Cloudflare Worker

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // --- Handle preflight CORS ---
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // --- Serve models from R2 bucket ---
    if (url.pathname.startsWith("/models/")) {
      const key = url.pathname.replace("/models/", "");
      const object = await env.BOB_MODELS.get(key);

      if (!object) {
        return new Response("Model not found", { status: 404, headers: corsHeaders });
      }

      return new Response(object.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "model/gltf-binary",
        },
      });
    }

    // --- Handle TTS (text-to-speech) ---
    if (url.pathname === "/tts" && request.method === "POST") {
      try {
        const { text = "", voice = "alloy" } = await request.json();

        if (!text.trim()) {
          return new Response("Missing text for TTS", { status: 400, headers: corsHeaders });
        }

        const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
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

        if (!ttsResp.ok) {
          const errText = await ttsResp.text();
          throw new Error(errText);
        }

        return new Response(ttsResp.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": "audio/mpeg",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // --- Handle Chat (AI responses) ---
    if (url.pathname === "/" && request.method === "POST") {
      try {
        const { prompt = "" } = await request.json();
        if (!prompt) throw new Error("Missing prompt");

        const chatResp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You are Bob, a raspy-voiced cowboy skeleton ghost. Respond with humor, mischief, and western slang. Keep it brief.",
              },
              { role: "user", content: prompt },
            ],
            max_tokens: 100,
          }),
        });

        if (!chatResp.ok) {
          const err = await chatResp.text();
          throw new Error(err);
        }

        const data = await chatResp.json();
        const reply =
          data.choices?.[0]?.message?.content ||
          "Well shoot, reckon I’m tongue-tied, partner.";

        return new Response(JSON.stringify({ reply }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // --- Default fallback ---
    return new Response("👻 Bob's Worker is alive!", { headers: corsHeaders });
  },
};
