// bob.js — Voice-Activated Bob the Skeleton 🤠💀
// Version 3 — Realistic TTS + Lip Sync + Worker Proxy

const bob = document.getElementById("bob");
if (!bob) console.warn("⚠️ No <model-viewer id='bob'> found in DOM.");

let isTalking = false;

// --- Core Animation Controls ---
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

// --- 🎧 Speech Recognition ---
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
  if (transcript.length > 0) await talkToBob(transcript);
};

// --- 🧠 Talk to AI Worker + Handle TTS ---
async function talkToBob(userInput) {
  try {
    isTalking = true;
    await playAnimation("Animation_Talk_withSkin", 2000);

    console.log("Talking to Bob:", userInput);

    // Step 1 — Call AI Worker
    const response = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput })
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const reply = data.reply || "(eerie silence...)";
    console.log("💬 Bob says:", reply);

    // Step 2 — Call Worker for TTS (using your existing API key securely)
    const ttsResponse = await fetch("https://ghostaiv1.alexmkennell.workers.dev/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: reply,
        voice: "verse", // raspy cowboy voice
        model: "gpt-4o-mini-tts"
      })
    });

    if (!ttsResponse.ok) throw new Error("TTS request failed.");
    const audioBlob = await ttsResponse.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Step 3 — Lip Sync During Audio Playback
    audio.onplay = () => startLipSync();
    audio.onended = () => stopLipSync();
    audio.play();

  } catch (err) {
    console.error("Error talking to Bob:", err);
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
    bob.animationName = open ? "Animation_Talk_withSkin" : "Animation_Long_Breathe_and_Look_Around_withSkin";
    open = !open;
  }, 200);
}

function stopLipSync() {
  if (!bob) return;
  console.log("👄 Lip sync stop");
  clearInterval(bob._lipSyncInterval);
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// --- 💤 Random Idle Behavior ---
function randomIdleBehavior() {
  if (isTalking) return;
  const idleAnims = [
    "Animation_Long_Breathe_and_Look_Around_withSkin",
    "Animation_Agree_Gesture_withSkin"
  ];
  const randomAnim = idleAnims[Math.floor(Math.random() * idleAnims.length)];
  playAnimation(randomAnim, 4000);
}
setInterval(randomIdleBehavior, 15000);

// --- 🎛 Initialize ---
window.addEventListener("DOMContentLoaded", () => {
  try {
    recognition.start();
    console.log("Bob’s ready for duty!");
    console.log("Auto voice recognition active.");
  } catch (err) {
    console.error("Speech recognition start failed:", err);
  }
});
