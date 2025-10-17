// bob.js — Voice-Activated Bob the Skeleton 🤠💀
// Version 4 — OpenAI TTS + Lip Sync + Feedback Fix

const bob = document.getElementById("bob");
if (!bob) console.warn("⚠️ No <model-viewer id='bob'> found in DOM.");

let isTalking = false;

// --- 🎬 Core Animation Control ---
async function playAnimation(name, duration = 3000) {
  if (!bob) {
    console.warn("Bob model not found in DOM.");
    return;
  }
  console.log("🎬 Bob animation:", name);
  bob.animationName = name;
  await new Promise(res => setTimeout(res, duration));
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// --- 🎧 Speech Recognition Setup ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "en-US";
recognition.continuous = true;
recognition.interimResults = false;

recognition.onstart = () => console.log("🎙 Bob is listening...");
recognition.onerror = (event) => console.error("Speech recognition error:", event);
recognition.onend = () => {
  console.log("Recognition ended. Restarting in 2s...");
  setTimeout(() => recognition.start(), 2000);
};

recognition.onresult = async (event) => {
  const transcript = event.results[event.results.length - 1][0].transcript.trim();
  console.log("👂 You said:", transcript);
  if (transcript.length > 0 && !isTalking) await talkToBob(transcript);
};

// --- 🧠 Talk to Bob via Worker + OpenAI TTS ---
async function talkToBob(userInput) {
  try {
    isTalking = true;
    recognition.stop(); // 🛑 Stop listening while Bob speaks

    await playAnimation("Animation_Talk_with_Left_Hand_Raised_withSkin", 1500);
    console.log("💬 Talking to Bob:", userInput);

    // Step 1 — Chat completion via Worker
    const response = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput })
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const reply = data.reply || "Well, I reckon I don't have much to say about that.";

    console.log("🤖 Bob replies:", reply);

    // Step 2 — TTS through the Worker
    const ttsResponse = await fetch("https://ghostaiv1.alexmkennell.workers.dev/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: reply,
        voice: "onyx", // OpenAI realistic raspy voice
        model: "gpt-4o-mini-tts"
      })
    });

    if (!ttsResponse.ok) throw new Error("TTS request failed.");
    const audioBlob = await ttsResponse.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Step 3 — Lip Sync & playback controls
    audio.onplay = () => {
      startLipSync();
      console.log("🔊 Bob is speaking...");
    };

    audio.onended = () => {
      stopLipSync();
      console.log("🔇 Bob finished talking.");
      setTimeout(() => recognition.start(), 1500); // 🎙 Resume listening
    };

    await audio.play();

  } catch (err) {
    console.error("Error talking to Bob:", err);
    setTimeout(() => recognition.start(), 2000);
  } finally {
    isTalking = false;
    await playAnimation("Animation_Long_Breathe_and_Look_Around_withSkin", 1000);
  }
}

// --- 👄 Lip Sync Animation ---
function startLipSync() {
  if (!bob) return;
  console.log("👄 Lip sync start");
  let open = false;
  bob._lipSyncInterval = setInterval(() => {
    bob.animationName = open
      ? "Animation_Talk_with_Hands_Open_withSkin"
      : "Animation_Talk_with_Right_Hand_Open_withSkin";
    open = !open;
  }, 220);
}

function stopLipSync() {
  if (!bob) return;
  clearInterval(bob._lipSyncInterval);
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// --- 💤 Random Idle Behavior ---
function randomIdleBehavior() {
  if (isTalking) return;
  const idleAnims = [
    "Animation_Long_Breathe_and_Look_Around_withSkin",
    "Animation_Agree_Gesture_withSkin",
    "Animation_Shrug_withSkin"
  ];
  const randomAnim = idleAnims[Math.floor(Math.random() * idleAnims.length)];
  playAnimation(randomAnim, 4000);
}
setInterval(randomIdleBehavior, 15000);

// --- 🚀 Initialize ---
window.addEventListener("DOMContentLoaded", () => {
  try {
    recognition.start();
    console.log("🤠 Bob’s ready for duty!");
  } catch (err) {
    console.error("Speech recognition start failed:", err);
  }
});
