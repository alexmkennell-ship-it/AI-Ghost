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
      const {
        text = "",
        voice = "alloy",
        format = "mp3",
        style,
      } = await request.json();

      if (!text.trim()) {
        return new Response("Missing text for TTS", {
          status: 400,
          headers: corsHeaders,
        });
      }

      const ttsResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-audio-preview",
          modalities: ["audio"],
          audio: {
            voice,
            format,
            ...(style ? { style } : {}),
          },
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text,
                },
              ],
            },
          ],
        }),
      });

      if (!ttsResponse.ok) {
        const errorText = await ttsResponse.text();
        return new Response(errorText || "TTS request failed", {
          status: ttsResponse.status,
          headers: corsHeaders,
        });
      }

      const data = await ttsResponse.json();
      const audioItem = data.output?.find(
        (item) => item.type === "output_audio" && item.audio?.data
      );

      if (!audioItem) {
        return new Response("No audio returned from model", {
          status: 502,
          headers: corsHeaders,
        });
      }

      const audioData = audioItem.audio.data;
      const audioFormat = audioItem.audio.format || format || "mp3";
      const binaryAudio = Uint8Array.from(atob(audioData), (c) =>
        c.charCodeAt(0)
      );

      const typeMap = {
        mp3: "audio/mpeg",
        wav: "audio/wav",
        opus: "audio/ogg",
        pcm16: "audio/wav",
      };

      return new Response(binaryAudio.buffer, {
        headers: {
          ...corsHeaders,
          "Content-Type": typeMap[audioFormat] || "audio/mpeg",
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
