const bob = document.getElementById("bob");
const promptBox = document.getElementById("prompt");

const baseURL = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/";

const animations = {
  idle: "Animation_Long_Breathe_and_Look_Around_withSkin.glb",
  wave: "Animation_Big_Wave_Hello_withSkin.glb",
  talk: "Animation_Talk_with_Hands_Open_withSkin.glb",
  walk: "Animation_Walking_withSkin.glb",
  shrug: "Animation_Shrug_withSkin.glb",
  alert: "Animation_Alert_withSkin.glb"
};

let state = "idle";
let isTalking = false;

function setAnimation(name) {
  if (state !== name) {
    state = name;
    bob.src = baseURL + animations[name];
  }
}

// --- Random idle motion ---
function randomIdleBehavior() {
  const idleChoices = ["idle", "shrug", "alert"];
  setInterval(() => {
    if (!isTalking && state === "idle") {
      const next = idleChoices[Math.floor(Math.random() * idleChoices.length)];
      setAnimation(next);
    }
  }, 15000);
}

// --- AI conversation logic ---
async function talkToAI(question) {
  try {
    isTalking = true;
    setAnimation("talk");
    promptBox.textContent = "💬 Thinking...";

    const response = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: question }),
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const reply = data.reply || "(bone-chilling silence...)";

    promptBox.textContent = `🗣️ ${reply}`;

    // Voice playback
    const utter = new SpeechSynthesisUtterance(reply);
    utter.rate = 0.9;
    speechSynthesis.speak(utter);
    utter.onend = () => {
      isTalking = false;
      setAnimation("idle");
      promptBox.textContent = "💀 Tap anywhere to talk to Bob 💀";
    };
  } catch (err) {
    console.error("Error:", err);
    isTalking = false;
    setAnimation("idle");
    promptBox.textContent = "💀 Tap anywhere to talk to Bob 💀";
  }
}

// --- Interaction ---
document.body.addEventListener("click", async () => {
  if (isTalking) return;
  setAnimation("wave");
  promptBox.textContent = "👋 Hey there!";

  setTimeout(async () => {
    const question = prompt("Ask Bob something spooky:");
    if (question) await talkToAI(question);
    else {
      setAnimation("idle");
      promptBox.textContent = "💀 Tap anywhere to talk to Bob 💀";
    }
  }, 2500);
});

// --- Start Idle ---
setAnimation("idle");
randomIdleBehavior();
