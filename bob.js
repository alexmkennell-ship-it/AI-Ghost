// -------------------------
// Bob the Skeleton JS (voice edition)
// -------------------------

const model = document.getElementById("bob");
if (!model) console.warn("⚠️ No <model-viewer id='bob'> found in DOM.");

let recognition;
let listening = false;

// -------------------------
// Speech Recognition Setup
// -------------------------
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    listening = true;
    console.log("🎙 Bob is listening...");
    playAnimation("idle");
  };

  recognition.onresult = async (event) => {
    const userSpeech = event.results[0][0].transcript;
    console.log("👂 You said:", userSpeech);
    await talkToBob(userSpeech);
  };

  recognition.onerror = (e) => console.error("Speech recognition error:", e);
  recognition.onend = () => {
    listening = false;
    console.log("Recognition ended. Restarting in 2s...");
    setTimeout(() => {
      if (!listening) recognition.start();
    }, 2000);
  };
} else {
  console.warn("Speech recognition not supported in this browser.");
}

// -------------------------
// Animation Helper
// -------------------------
function playAnimation(type) {
  if (!model) return console.warn("Bob model not found in DOM.");
  console.log("Bob animation:", type);

  switch (type) {
    case "wave":
      model.setAttribute("animation-name", "Animation_Wave_withSkin");
      break;
    case "talk":
      model.setAttribute("animation-name", "Animation_Talk_withSkin");
      break;
    default:
      model.setAttribute("animation-name", "Animation_Long_Breathe_and_Look_Around_withSkin");
  }
}

// -------------------------
// Talk to Bob via Worker (AI + Voice)
// -------------------------
async function talkToBob(promptText) {
  try {
    console.log("Talking to Bob:", promptText);
    playAnimation("talk");

    // --- Stop listening while Bob speaks ---
    if (recognition && listening) recognition.stop();

    // --- Ask AI for response ---
    const aiRes = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptText }),
    });

    if (!aiRes.ok) throw new Error(await aiRes.text());
    const { reply } = await aiRes.json();
    console.log("💬 Bob says:", reply);

    // --- Request TTS from Worker ---
    const ttsRes = await fetch("https://ghostaiv1.alexmkennell.workers.dev/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply }),
    });

    if (!ttsRes.ok) throw new Error("TTS fetch failed.");

    // --- Play AI voice ---
    const audioBlob = await ttsRes.blob();
    const audioURL = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioURL);

    audio.onplay = () => console.log("🔊 Bob speaking...");
    audio.onended = () => {
      console.log("✅ Bob finished speaking.");
      playAnimation("idle");
      setTimeout(() => recognition.start(), 1000);
    };

    audio.play();
  } catch (err) {
    console.error("Error talking to Bob:", err);
    playAnimation("idle");
    if (recognition) recognition.start();
  }
}

// -------------------------
// Random Idle Behavior
// -------------------------
function randomIdleBehavior() {
  const random = Math.random();
  if (random < 0.2) playAnimation("wave");
  else playAnimation("idle");
}

// -------------------------
// Initialize
// -------------------------
window.addEventListener("DOMContentLoaded", () => {
  console.log("Bob’s ready for duty!");
  playAnimation("idle");

  if (recognition) {
    console.log("Auto voice recognition active.");
    recognition.start();
  }

  setInterval(randomIdleBehavior, 15000); // every 15 seconds
});
