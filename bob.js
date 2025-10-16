// -------------------------------
// Bob the Bone Cowboy - Frontend
// -------------------------------

// URL of your Cloudflare Worker
const workerURL = "https://ghostaiv1.alexmkennell.workers.dev/";

// Select elements
const bobModel = document.querySelector("#bobModel");
const talkButton = document.querySelector("#talkButton");

// Animation clips (must match what’s in Meshy / your bucket)
const animations = {
  idle: "Animation_Long_Breathe_and_Look_Around_withSkin.glb",
  wave: "Animation_Agree_Gesture_withSkin.glb",
  talk: "Animation_Talk_withSkin.glb" // optional if you have it
};

// State control
let isTalking = false;
let isIdle = true;

// --- Helper: play a model animation ---
function playAnimation(name) {
  if (!bobModel) return console.error("Bob model not found in DOM.");
  bobModel.src = `https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/${animations[name]}`;
  console.log(`Bob animation: ${name}`);
}

// --- AI Conversation Logic ---
async function talkToBob(prompt) {
  try {
    console.log("Talking to Bob:", prompt);
    isTalking = true;
    playAnimation("talk");

    const response = await fetch(workerURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Worker error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const reply = data.reply || "Well, partner, I reckon I'm speechless.";

    // Output in console (you can also show this in HTML)
    console.log("Bob says:", reply);

    // Optional speech output
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

// --- Event: Talk button clicked ---
if (talkButton) {
  talkButton.addEventListener("click", async () => {
    if (isTalking) return;
    const prompt = prompt("Ask Bob something:");
    if (prompt) await talkToBob(prompt);
  });
} else {
  console.warn("No talkButton found — Bob will listen for clicks instead.");
  document.body.addEventListener("click", async () => {
    if (isTalking) return;
    const prompt = prompt("Ask Bob something:");
    if (prompt) await talkToBob(prompt);
  });
}

// --- Random idle behavior ---
function randomIdleBehavior() {
  if (isTalking) return;
  const r = Math.random();
  if (r < 0.2) playAnimation("wave");
  else playAnimation("idle");
}

setInterval(randomIdleBehavior, 15000); // every 15s

// --- On load ---
window.addEventListener("DOMContentLoaded", () => {
  console.log("Bob’s ready for duty!");
  playAnimation("idle");
});
