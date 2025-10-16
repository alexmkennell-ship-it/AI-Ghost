// -------------------------------
// Bob the Bone Cowboy - Frontend
// -------------------------------

// URL of your Cloudflare Worker
const workerURL = "https://ghostaiv1.alexmkennell.workers.dev/";

// Select elements
const bobModel = document.querySelector("#bobModel");
const talkButton = document.querySelector("#talkButton");

// Animation clips
const animations = {
  idle: "Animation_Long_Breathe_and_Look_Around_withSkin.glb",
  wave: "Animation_Agree_Gesture_withSkin.glb",
  talk: "Animation_Talk_withSkin.glb" // optional if you have it
};

// State control
let isTalking = false;

// --- Helper: play a model animation ---
function playAnimation(name) {
  if (!bobModel) {
    console.error("Bob model not found in DOM.");
    return;
  }
  bobModel.src = `https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/${animations[name]}`;
  console.log(`Bob animation: ${name}`);
}

// --- AI Conversation Logic ---
async function talkToBob(userInput) {
  try {
    console.log("Talking to Bob:", userInput);
    isTalking = true;
    playAnimation("talk");

    const response = await fetch(workerURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Worker error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const reply = data.reply || "Well, partner, I reckon I'm speechless.";

    console.log("Bob says:", reply);

    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);

    utterance.onend = () => {
      isTalking = false;
      playAnimation("idle");
    };
  } catch (err) {
    console.error("Error talking to Bob:", err);
    isTalking = false;
    playAnimation("idle");
  }
}

// --- Event: Talk button or body click ---
function initConversationTrigger() {
  if (talkButton) {
    talkButton.addEventListener("click", async () => {
      if (isTalking) return;
      const question = window.prompt("Ask Bob something:");
      if (question) await talkToBob(question);
    });
  } else {
    console.warn("No talkButton found — Bob will listen for body clicks instead.");
    document.body.addEventListener("click", async () => {
      if (isTalking) return;
      const question = window.prompt("Ask Bob something:");
      if (question) await talkToBob(question);
    });
  }
}

// --- Random idle behavior ---
function randomIdleBehavior() {
  if (isTalking) return;
  const r = Math.random();
  if (r < 0.25) playAnimation("wave");
  else playAnimation("idle");
}

// --- On load ---
window.addEventListener("DOMContentLoaded", () => {
  console.log("Bob’s ready for duty!");
  playAnimation("idle");
  initConversationTrigger();
  setInterval(randomIdleBehavior, 15000); // every 15s
});
