const bob = document.getElementById("bob");

let state = "idle";
let isTalking = false;

// Preload models (optional, for smoother switching)
const models = {
  idle: "models/bob_idle.glb",
  wave: "models/bob_wave.glb",
  talk: "models/bob_talk.glb",
  walk: "models/bob_walk.glb"
};

// Idle looping behavior
function startIdle() {
  state = "idle";
  bob.src = models.idle;
  randomIdleCycle();
}

// Random silly idles
function randomIdleCycle() {
  const idleOptions = [models.idle, models.walk, models.wave];
  setInterval(() => {
    if (!isTalking && state === "idle") {
      const next = idleOptions[Math.floor(Math.random() * idleOptions.length)];
      bob.src = next;
    }
  }, 15000); // every 15s pick a random idle
}

// Conversation trigger
document.body.addEventListener("click", async () => {
  if (state === "idle") {
    state = "wave";
    bob.src = models.wave;

    setTimeout(async () => {
      const prompt = prompt("Ask Bob something spooky:");
      if (prompt) await talkToAI(prompt);
    }, 2000);
  }
});

// Connect to AI worker and talk
async function talkToAI(userInput) {
  try {
    isTalking = true;
    bob.src = models.talk;

    const response = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput }),
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const reply = data.reply || "(eerie silence…)";

    // Speak the reply
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);

    utterance.onend = () => {
      isTalking = false;
      startIdle();
    };
  } catch (err) {
    console.error("Error:", err);
    isTalking = false;
    startIdle();
  }
}

// Start everything
startIdle();
