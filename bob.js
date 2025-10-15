const bob = document.getElementById("bob");

const animations = {
  idle: "models/idle.glb",
  wave: "models/wave.glb",
  talk: "models/talk.glb",
  walk: "models/walk.glb",
  alert: "models/alert.glb",
  shrug: "models/shrug.glb",
  arise: "models/arise.glb"
};

let state = "idle";
let isTalking = false;

function setAnimation(name) {
  state = name;
  bob.src = animations[name];
}

// --- Random Idle Movements ---
function randomIdleBehavior() {
  const idleOptions = ["idle", "shrug", "alert"];
  setInterval(() => {
    if (!isTalking && state === "idle") {
      const next = idleOptions[Math.floor(Math.random() * idleOptions.length)];
      setAnimation(next);
    }
  }, 15000); // 15 seconds
}

// --- AI Talking Logic ---
async function talkToAI(promptText) {
  try {
    isTalking = true;
    setAnimation("talk");

    const response = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptText }),
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const reply = data.reply || "(bone-chilling silence...)";

    const utter = new SpeechSynthesisUtterance(reply);
    utter.rate = 0.9;
    speechSynthesis.speak(utter);
    utter.onend = () => {
      isTalking = false;
      setAnimation("idle");
    };
  } catch (err) {
    console.error(err);
    isTalking = false;
    setAnimation("idle");
  }
}

// --- When user clicks ---
document.body.addEventListener("click", async () => {
  if (state === "idle") {
    setAnimation("wave");
    setTimeout(async () => {
      const question = prompt("Ask Bob something spooky:");
      if (question) await talkToAI(question);
    }, 2000);
  }
});

// Start idle mode
setAnimation("idle");
randomIdleBehavior();
