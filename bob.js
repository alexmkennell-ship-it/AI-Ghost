diff --git a/bob.js b/bob.js
index 9716ce95010e48d1b33c9bd4f7f0c2590b1b8545..f9b8d1a779c1029b76d73f42da4d17a8f501cf64 100644
--- a/bob.js
+++ b/bob.js
@@ -1,75 +1,97 @@
-const viewer = document.getElementById("bob");
-
-// your Cloudflare Worker endpoint
 const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev/";
 
-// Animation library
 const animations = {
   idle: "Animation_Long_Breathe_and_Look_Around_withSkin.glb",
   wave: "Animation_Big_Wave_Hello_withSkin.glb",
   talk: "Animation_Talk_with_Hands_Open_withSkin.glb",
 };
 
 let state = "idle";
+let viewer;
 
 async function loadAnimation(type, loop = true) {
-  if (!animations[type]) return;
-  state = type;
+  if (!viewer || !animations[type]) return;
 
+  state = type;
   viewer.src = `https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/${animations[type]}`;
   viewer.autoplay = true;
 
   if (!loop) {
-    viewer.addEventListener("finished", () => {
-      if (state === "wave") startIdle();
-    }, { once: true });
+    viewer.addEventListener(
+      "finished",
+      () => {
+        if (state === "wave") startIdle();
+      },
+      { once: true },
+    );
   }
 }
 
 function startIdle() {
   loadAnimation("idle", true);
 }
 
 async function startConversation() {
-  // wave first
+  if (!viewer) return;
+
   await loadAnimation("wave", false);
 
   setTimeout(async () => {
-    const prompt = prompt("Ask Bob something spooky:");
-    if (prompt) await talkToAI(prompt);
+    const question = window.prompt("Ask Bob something spooky:");
+
+    if (!question || !question.trim()) {
+      startIdle();
+      return;
+    }
+
+    await talkToAI(question.trim());
   }, 3500);
 }
 
 async function talkToAI(userInput) {
+  if (!viewer) return;
+
   try {
     await loadAnimation("talk", true);
 
     const response = await fetch(WORKER_URL, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ prompt: userInput }),
     });
 
     if (!response.ok) throw new Error(await response.text());
     const data = await response.json();
     const reply = data.reply || "(eerie silence...)";
 
-    // Speak reply
     const utterance = new SpeechSynthesisUtterance(reply);
     utterance.rate = 0.9;
     speechSynthesis.speak(utterance);
 
     utterance.onend = () => startIdle();
   } catch (err) {
     console.error("Error:", err);
     startIdle();
   }
 }
 
-// Start idle on load
-viewer.addEventListener("load", () => startIdle());
+function initialize() {
+  viewer = document.getElementById("bob");
 
-// Click anywhere to trigger
-document.body.addEventListener("click", () => {
-  if (state === "idle") startConversation();
-});
+  if (!viewer) {
+    console.error("Bob's model-viewer element could not be found.");
+    return;
+  }
+
+  startIdle();
+
+  document.body.addEventListener("click", () => {
+    if (state === "idle") startConversation();
+  });
+}
+
+if (document.readyState === "loading") {
+  document.addEventListener("DOMContentLoaded", initialize);
+} else {
+  initialize();
+}
