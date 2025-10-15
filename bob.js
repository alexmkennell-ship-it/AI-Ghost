const viewer = document.getElementById("bob");

// your Cloudflare Worker endpoint
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev/";

// Animation library
const animations = {
  idle: "Animation_Long_Breathe_and_Look_Around_withSkin.glb",
  wave: "Animation_Big_Wave_Hello_withSkin.glb",
  talk: "Animation_Talk_with_Hands_Open_withSkin.glb",
};

let state = "idle";

async function loadAnimation(type, loop = true) {
  if (!animations[type]) return;
  state = type;

  viewer.src = `https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/${animations[type]}`;
  viewer.autoplay = true;

  if (!loop) {
    viewer.addEventListener("finished", () => {
      if (state === "wave") startIdle();
    }, { once: true });
  }
}

function startIdle() {
  loadAnimation("idle", true);
}

async function startConversation() {
  // wave first
  await loadAnimation("wave", false);

  setTimeout(async () => {
    const prompt = prompt("Ask Bob something spooky:");
    if (prompt) await talkToAI(prompt);
  }, 3500);
}

async function talkToAI(userInput) {
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

    // Speak reply
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);

    utterance.onend = () => startIdle();
  } catch (err) {
    console.error("Error:", err);
    startIdle();
  }
}

// Start idle on load
viewer.addEventListener("load", () => startIdle());

// Click anywhere to trigger
document.body.addEventListener("click", () => {
  if (state === "idle") startConversation();
});
