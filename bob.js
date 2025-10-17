// bob.js — final animated & voiced version

const bob = document.getElementById("bob");
const status = document.getElementById("status");
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";

// 🎬 Animation Pools
const idleAnimations = [
  "Animation_Long_Breathe_and_Look_Around_withSkin",
  "Animation_Mummy_Stagger_withSkin",
  "Animation_Running_withSkin",
  "Animation_Indoor_Play_withSkin",
  "Animation_Sleep_Normally_withSkin",
];

const talkAnimations = [
  "Animation_Talk_Passionately_withSkin",
  "Animation_Talk_with_Hands_Open_withSkin",
  "Animation_Talk_with_Left_Hand_Raised_withSkin",
  "Animation_Talk_with_Right_Hand_Open_withSkin",
  "Animation_Agree_Gesture_withSkin",
];

const reactionAnimations = {
  unsure: "Animation_Shrug_withSkin",
  wave: "Animation_Big_Wave_Hello_withSkin",
  angry: "Animation_Angry_Ground_Stomp_withSkin",
};

let talkAnimInterval = null;

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function playAnimation(name, duration = 2500) {
  if (!bob) return;
  bob.animationName = name;
  await sleep(duration);
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// 🧍 Idle Randomizer
function startIdleCycle() {
  setInterval(() => {
    const next = idleAnimations[Math.floor(Math.random() * idleAnimations.length)];
    console.log("🕰️ Idle swap →", next);
    bob.animationName = next;
  }, 40000 + Math.random() * 30000); // every 40–70 seconds
}

// 🗣️ Talking Animation Loop
function startTalking() {
  stopTalking(); // clear any existing
  talkAnimInterval = setInterval(() => {
    const next = talkAnimations[Math.floor(Math.random() * talkAnimations.length)];
    bob.animationName = next;
  }, 1500 + Math.random() * 1000);
}

function stopTalking() {
  if (talkAnimInterval) clearInterval(talkAnimInterval);
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// 🎙️ Voice Recognition
function startVoiceRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    status.textContent = "❌ Speech recognition not supported in this browser.";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => (status.textContent = "👂 Listening…");

  recognition.onresult = async (event) => {
    const transcript =
      event.results[event.results.length - 1][0].transcript.trim();
    if (!transcript) return;
    status.textContent = `💬 “${transcript}”`;
    recognition.stop();
    await talkToBob(transcript);
  };

  recognition.onerror = () => (status.textContent = "⚠️ Mic error — restarting.");
  recognition.onend = () => setTimeout(() => recognition.start(), 1500);
  recognition.start();
}

// 💬 AI + TTS Logic
async function talkToBob(userInput) {
  try {
    console.log("🎙️ User:", userInput);

    // Step 1 — Chat
    const chatResp = await fetch(`${WORKER_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput }),
    });
    if (!chatResp.ok) throw new Error("Chat request failed");
    const { reply } = await chatResp.json();
    console.log("💀 Bob:", reply);
    status.textContent = reply || "(skeletal silence…)";

    // Step 2 — Choose reaction if applicable
    if (/shrug|unsure|maybe|don't know/i.test(reply))
      bob.animationName = reactionAnimations.unsure;
    else if (/hello|hi|howdy/i.test(reply))
      bob.animationName = reactionAnimations.wave;
    else if (/mad|angry|heck|dang/i.test(reply))
      bob.animationName = reactionAnimations.angry;

    // Step 3 — Get TTS (Sage voice)
    console.log("👉 Requesting Sage TTS...");
    const ttsResp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "sage" }),
    });
    if (!ttsResp.ok) throw new Error(`TTS failed: ${ttsResp.status}`);

    const blob = await ttsResp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    console.log("🎧 Playing TTS:", url);

    audio.onplay = startTalking;
    audio.onended = stopTalking;

    try {
      await audio.play();
    } catch (err) {
      console.warn("⚠️ Autoplay blocked, waiting for click to start audio.");
      status.textContent = "👆 Click anywhere to let Bob speak.";
      document.body.addEventListener(
        "click",
        () => {
          audio.play();
          status.textContent = "🎧 Bob's talkin’ now!";
        },
        { once: true }
      );
    }
  } catch (err) {
    console.error("💀 Error talking to Bob:", err);
    status.textContent = "💀 Bob’s connection got spooked.";
  }
}

// 🧠 Initialize
window.addEventListener("DOMContentLoaded", () => {
  if (!bob) return;
  bob.addEventListener("load", () => {
    console.log("✅ Bob ready!");
    status.textContent = "👆 Click to wake Bob up.";
    startIdleCycle();
  });
});
