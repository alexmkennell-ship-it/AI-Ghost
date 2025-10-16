diff --git a/worker-ghostaiv1/index.js b/worker-ghostaiv1/index.js
index c3a003172f702fa5185a3bd74a55ee4f38de6256..be8d8c6ab0062b90980ed3593bc051e109eeb938 100644
--- a/worker-ghostaiv1/index.js
+++ b/worker-ghostaiv1/index.js
@@ -1,36 +1,60 @@
 const CORS_HEADERS = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
   "Access-Control-Allow-Headers": "Content-Type",
 };
 
 export default {
   async fetch(request, env) {
     if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
     if (request.method !== "POST") return new Response("POST only", { status: 405, headers: CORS_HEADERS });
 
-    const { prompt } = await request.json();
-
-    const response = await fetch("https://api.openai.com/v1/chat/completions", {
-      method: "POST",
-      headers: {
-        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
-        "Content-Type": "application/json",
-      },
-      body: JSON.stringify({
-        model: "gpt-4o-mini",
-        messages: [
-          { role: "system", content: "You are Bob, a funny animated skeleton ghost that chats with kids on a hayride." },
-          { role: "user", content: prompt },
-        ],
-      }),
-    });
-
-    const data = await response.json();
-    const reply = data.choices?.[0]?.message?.content?.trim() || "Boo?";
-
-    return new Response(JSON.stringify({ reply }), {
-      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
-    });
+    try {
+      if (!env?.OPENAI_API_KEY) {
+        return new Response("Missing OPENAI_API_KEY binding", { status: 500, headers: CORS_HEADERS });
+      }
+
+      const body = await request.json().catch(() => null);
+      const prompt = body?.prompt?.toString().trim();
+
+      if (!prompt) {
+        return new Response("Prompt is required", { status: 400, headers: CORS_HEADERS });
+      }
+
+      const response = await fetch("https://api.openai.com/v1/chat/completions", {
+        method: "POST",
+        headers: {
+          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
+          "Content-Type": "application/json",
+        },
+        body: JSON.stringify({
+          model: "gpt-4o-mini",
+          messages: [
+            { role: "system", content: "You are Bob, a funny animated skeleton ghost that chats with kids on a hayride." },
+            { role: "user", content: prompt },
+          ],
+        }),
+      });
+
+      if (!response.ok) {
+        const errorText = await response.text();
+        return new Response(errorText || "Upstream request failed", {
+          status: response.status,
+          headers: { ...CORS_HEADERS, "Content-Type": "text/plain" },
+        });
+      }
+
+      const data = await response.json();
+      const reply = data.choices?.[0]?.message?.content?.trim() || "Boo?";
+
+      return new Response(JSON.stringify({ reply }), {
+        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
+      });
+    } catch (err) {
+      return new Response(err.message || "Unexpected error", {
+        status: 500,
+        headers: CORS_HEADERS,
+      });
+    }
   },
 };
