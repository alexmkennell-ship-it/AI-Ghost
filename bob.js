const bob = document.getElementById("bob");

const animations = {
  idle: ["bobidle1.png", "bobidle2.png", "bobidlelookleft.png", "bobidlelookright.png"],
  wave: ["bobwavecenter.png", "bobwaveleft.png", "bobwaveright.png", "bobwavecenter.png"],
  talk: ["bobmouthclosed.png", "bobmouthopenmid.png", "bobmouthopen.png", "bobmouthopenmid.png"],
};

let state = "idle";
let frame = 0;
let animInterval = null;

// --- Animation Function ---
function playAnimation(type, loop = true, frameDelay = 200, callback = null) {
  clearInterval(animInterval);
  const frames = animations[type];
  frame = 0;
  state = type;

  animInterval = setInterval(() => {
    bob.src = `images/${frames[frame]}`;
    frame++;

    if (frame >= frames.length) {
      if (loop) frame = 0;
      else {
        clearInterval(animInterval);
        if (callback) callback();
      }
    }
  }, frameDelay);
}

// --- Looping Animations ---
function startIdle() {
  playAnimation("idle", true, 300);
}

function startConversation() {
  // Wave once, then go into listen/talk mode
  playAnimation("wave", false, 200, async () => {
    // Ask user for prompt (temporary simple input)
    const prompt = prompt("Ask Bob something spooky:");
    if (prompt) await talkToAI(prompt);
  });
}

// --- AI Connection ---
async function talkToAI(userInput) {
  try {
    playAnimation("talk", true, 120);

    const response = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput }),
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const reply = data.reply || "(eerie silence…)";

    // Stop talking animation, log the reply
    clearInterval(animInterval);
    console.log("Bob says:", reply);

    // Optional: Use speech synthesis
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);

    utterance.onend = () => startIdle();
  } catch (err) {
    console.error("Error:", err);
    startIdle();
  }
}

// --- Start idle loop ---
startIdle();

// --- Click anywhere to talk to Bob ---
document.body.addEventListener("click", () => {
  if (state === "idle") startConversation();
});
