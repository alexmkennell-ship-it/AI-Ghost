// bob.js — Voice-Activated Bob with OpenAI TTS 🎙💀

const bob = document.getElementById("bob");
if (!bob) console.warn("⚠️ No <model-viewer id='bob'> found.");

let isTalking = false;

// Simple animation controls
async function playAnimation(name, duration = 2500) {
  if (!bob) return;
  bob.animationName = name;
  await new Promise(res => setTimeout(res, duration));
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// --- 🎧 Speech Recognition ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "en-US";
recognition.continuous = true;

recognition.onstart = () => console.log("🎙 Listening...");
recognition.onerror = e => console.warn("Speech error:", e.error);
recognition.onend = () => setTimeout(() => recognition.start(), 2000);
recognition.onresult = e => {
  const transcript = e.results[e.results.length - 1][0].transcript.trim();
  console.log("👂 You said:", transcript);
  if (transcript) talkToBob(transcript);
};

// --- 💬 Talk to Worker and Speak via OpenAI Voice ---
async function talkToBob(userInput) {
  if (isTalking) return;
  isTalking = true;

  try {
    await playAnimation("Animation_Talk_Passionately_withSkin", 2000);
    console.log("Talking to Bob:", userInput);

    // Step 1: Ask worker for text reply
    const chatResp = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput })
    });

    const { reply } = await chatResp.json();
    console.log("💬 Bob says:", reply);

    // Step 2: Get audio (TTS)
    const ttsResp = await fetch("https://ghostaiv1.alexmkennell.workers.dev/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: reply,
        model: "gpt-4o-mini-tts",
        voice: "alloy" // try "alloy" or "verse" for grittier tone
      })
    });

    if (!ttsResp.ok) throw new Error("TTS failed");

    const audioBlob = await ttsResp.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Sync mouth
    audio.onplay = () => startLipSync();
    audio.onended = () => stopLipSync();
    await audio.play();

  } catch (e) {
    console.error("💀 Error talking to Bob:", e);
  } finally {
    isTalking = false;
    playAnimation("Animation_Long_Breathe_and_Look_Around_withSkin", 1000);
  }
}

// --- 👄 Lip Sync ---
function startLipSync() {
  if (!bob) return;
  console.log("👄 Lip sync start");
  let open = false;
  bob._lipSync = setInterval(() => {
    bob.animationName = open ? "Animation_Talk_with_Right_Hand_Open_withSkin" : "Animation_Talk_with_Left_Hand_Raised_withSkin";
    open = !open;
  }, 200);
}
function stopLipSync() {
  if (!bob) return;
  console.log("👄 Lip sync stop");
  clearInterval(bob._lipSync);
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// --- 💤 Idle behavior ---
setInterval(() => {
  if (!isTalking) playAnimation("Animation_Agree_Gesture_withSkin", 3000);
}, 15000);

window.addEventListener("DOMContentLoaded", () => {
  try {
    recognition.start();
    console.log("🤠 Bob’s ready and listening.");
  } catch (e) {
    console.error("Speech start error:", e);
  }
});
