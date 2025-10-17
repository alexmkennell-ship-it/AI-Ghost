// bob.js — Frontend for Bob the Bone Cowboy

const bob = document.getElementById("bob");
const status = document.getElementById("status");
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function playAnimation(name, duration = 2500) {
  if (!bob) return;
  bob.animationName = name;
  await sleep(duration);
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// 🎙️ Voice Recognition
function startVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    status.textContent = "❌ Speech recognition not supported in this browser.";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => {
    status.textContent = "👂 Listening…";
  };

  recognition.onresult = async (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.trim();
    if (!transcript) return;
    status.textContent = `💬 “${transcript}”`;
    recognition.stop();
    await talkToBob(transcript);
  };

  recognition.onerror = () => {
    status.textContent = "⚠️ Mic error — restarting.";
  };

  recognition.onend = () => setTimeout(() => recognition.start(), 1500);
  recognition.start();
}

// 💬 AI + TTS logic
async function talkToBob(userInput) {
  try {
    await playAnimation("Animation_Talk_Passionately_withSkin", 1000);

    // Step 1: Chat with AI
    const chatResp = await fetch(`${WORKER_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput }),
    });

    const { reply } = await chatResp.json();
    status.textContent = reply || "(skeletal silence…)";
    console.log("💀 Bob:", reply);

    // Step 2: Get audio from Worker
    const ttsResp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "alloy" }),
    });

    if (!ttsResp.ok) throw new Error("TTS failed");

    const blob = await ttsResp.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);

    audio.onplay = () =>
      (bob.animationName = "Animation_Talk_Passionately_withSkin");
    audio.onended = () =>
      (bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin");

    audio.play();
  } catch (err) {
    console.error("Error talking to Bob:", err);
    status.textContent = "💀 Bob’s connection got spooked.";
  }
}

// 🧠 Init
window.addEventListener("DOMContentLoaded", () => {
  if (!bob) return;
  bob.addEventListener("load", () => {
    console.log("✅ Bob ready!");
    status.textContent = "🎙 Say somethin’, partner…";
    startVoiceRecognition();
  });
});
