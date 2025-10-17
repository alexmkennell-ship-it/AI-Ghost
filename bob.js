// bob.js — Raspy Voice + Smooth Prefetch 🤠💀
// Version 6 (using Worker’s OpenAI TTS + smarter animation flow)

const bob = document.getElementById("bob");
if (!bob) console.warn("⚠️ No <model-viewer id='bob'> found in DOM.");

let isTalking = false;
let nextIdleAnim = null;

// 🧰 Base URL for models
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// 🎬 Play animation helper
async function playAnimation(name, duration = 3000) {
  if (!bob) return console.warn("Bob model not found.");
  bob.src = `${MODEL_BASE}${name}.glb`;
  await new Promise(res => setTimeout(res, duration));
}

// 🔄 Prefetch animation (loads silently into browser cache)
async function prefetchAnimation(name) {
  try {
    const url = `${MODEL_BASE}${name}.glb`;
    const response = await fetch(url, { method: "GET", mode: "no-cors" });
    console.log("Prefetched:", name, response.ok ? "✅" : "⚠️");
  } catch (e) {
    console.warn("Prefetch failed:", name, e);
  }
}

// 👄 Lip Sync (switches talk animations)
function startLipSync(audio) {
  if (!bob) return;
  const moves = [
    "Animation_Talk_with_Hands_Open_withSkin",
    "Animation_Talk_with_Right_Hand_Open_withSkin",
    "Animation_Talk_with_Left_Hand_Raised_withSkin"
  ];
  let i = 0;
  bob._lipSyncInterval = setInterval(() => {
    bob.src = `${MODEL_BASE}${moves[i]}.glb`;
    i = (i + 1) % moves.length;
  }, 400);
  audio.addEventListener("ended", stopLipSync);
}

function stopLipSync() {
  if (!bob) return;
  clearInterval(bob._lipSyncInterval);
  bob.src = `${MODEL_BASE}Animation_Long_Breathe_and_Look_Around_withSkin.glb`;
}

// 🧠 Talk to Worker + OpenAI TTS
async function talkToBob(userInput) {
  try {
    isTalking = true;
    console.log("Talking to Bob:", userInput);

    // Pick random “talk” animation
    const talkMoves = [
      "Animation_Talk_with_Hands_Open_withSkin",
      "Animation_Talk_Passionately_withSkin",
      "Animation_Talk_with_Right_Hand_Open_withSkin"
    ];
    const talkAnim = talkMoves[Math.floor(Math.random() * talkMoves.length)];

    await playAnimation(talkAnim, 2500);

    // 1️⃣ Ask Worker for response
    const replyRes = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput })
    });

    if (!replyRes.ok) throw new Error(await replyRes.text());
    const { reply } = await replyRes.json();
    console.log("💬 Bob says:", reply);

    // 2️⃣ Get TTS audio (deep raspy OpenAI voice)
    const ttsRes = await fetch("https://ghostaiv1.alexmkennell.workers.dev/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: reply,
        voice: "onyx", // deep cowboy tone
        model: "gpt-4o-mini-tts"
      })
    });

    if (!ttsRes.ok) throw new Error("TTS failed");
    const audioBlob = await ttsRes.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // 3️⃣ Animate while talking
    audio.onplay = () => startLipSync(audio);
    audio.onended = () => stopLipSync();
    audio.play();

    // Prefetch a random next idle animation for smooth transition
    const idleList = [
      "Animation_Agree_Gesture_withSkin",
      "Animation_Alert_withSkin",
      "Animation_Shrug_withSkin",
      "Animation_Sleep_Normally_withSkin"
    ];
    nextIdleAnim = idleList[Math.floor(Math.random() * idleList.length)];
    prefetchAnimation(nextIdleAnim);

    // Wait for TTS to finish
    await new Promise(res => audio.addEventListener("ended", res));

  } catch (err) {
    console.error("💀 Error talking to Bob:", err);
    await playAnimation("Animation_Shrug_withSkin", 2500);
  } finally {
    isTalking = false;
    await playAnimation(nextIdleAnim || "Animation_Long_Breathe_and_Look_Around_withSkin", 2000);
  }
}

// 💤 Random idle routine
function randomIdleBehavior() {
  if (isTalking) return;
  const idles = [
    "Animation_Long_Breathe_and_Look_Around_withSkin",
    "Animation_Agree_Gesture_withSkin",
    "Animation_Shrug_withSkin",
    "Animation_Alert_Quick_Turn_Right_withSkin"
  ];
  const pick = idles[Math.floor(Math.random() * idles.length)];
  playAnimation(pick, 4000);
}
setInterval(randomIdleBehavior, 15000);

// 🎧 Speech Recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "en-US";
recognition.continuous = true;
recognition.interimResults = false;

recognition.onstart = () => console.log("🎙 Bob is listenin’...");
recognition.onerror = e => console.error("Speech error:", e);
recognition.onend = () => setTimeout(() => recognition.start(), 2000);

recognition.onresult = async e => {
  const phrase = e.results[e.results.length - 1][0].transcript.trim();
  if (phrase.length > 0) await talkToBob(phrase);
};

// 🚀 Init
window.addEventListener("DOMContentLoaded", () => {
  try {
    recognition.start();
    console.log("🤠 Bob’s ready to chat, partner.");
    prefetchAnimation("Animation_Long_Breathe_and_Look_Around_withSkin");
  } catch (e) {
    console.error("Speech recognition start failed:", e);
  }
});
