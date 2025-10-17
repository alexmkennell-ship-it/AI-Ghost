// bob.js — Full Animation Personality + Realistic Voice 🤠💀
// Version 5

const bob = document.getElementById("bob");
if (!bob) console.warn("⚠️ No <model-viewer id='bob'> found in DOM.");

let isTalking = false;

// 🎬 Animation Helper
async function playAnimation(name, duration = 3000) {
  if (!bob) {
    console.warn("Bob model not found in DOM.");
    return;
  }
  console.log("🎬 Bob animation:", name);
  bob.src = `https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/${name}.glb`;
  await new Promise(res => setTimeout(res, duration));
  bob.src = `https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/Animation_Long_Breathe_and_Look_Around_withSkin.glb`;
}

// 🧠 Talk to AI Worker + OpenAI TTS
async function talkToBob(userInput) {
  try {
    isTalking = true;

    // Random talking animation for variety
    const talkAnimations = [
      "Animation_Talk_with_Hands_Open_withSkin",
      "Animation_Talk_with_Right_Hand_Open_withSkin",
      "Animation_Talk_with_Left_Hand_Raised_withSkin",
      "Animation_Talk_Passionately_withSkin"
    ];
    const randomTalk = talkAnimations[Math.floor(Math.random() * talkAnimations.length)];
    await playAnimation(randomTalk, 2500);

    console.log("Talking to Bob:", userInput);

    // Step 1 — Chat completion
    const chatResponse = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput })
    });

    if (!chatResponse.ok) throw new Error(await chatResponse.text());
    const data = await chatResponse.json();
    const reply = data.reply || "(eerie silence...)";
    console.log("💬 Bob says:", reply);

    // Step 2 — TTS request (deep cowboy voice)
    const ttsResponse = await fetch("https://ghostaiv1.alexmkennell.workers.dev/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: reply,
        voice: "onyx", // gravelly raspy voice
        model: "gpt-4o-mini-tts"
      })
    });

    if (!ttsResponse.ok) throw new Error(`TTS failed: ${ttsResponse.statusText}`);

    const audioBlob = await ttsResponse.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Lip sync + gestures
    audio.onplay = () => startLipSync(audio);
    audio.onended = () => stopLipSync();
    audio.play();

  } catch (err) {
    console.error("Error talking to Bob:", err);
    await playAnimation("Animation_Shrug_withSkin", 2500);
  } finally {
    isTalking = false;
    await playAnimation("Animation_Long_Breathe_and_Look_Around_withSkin", 1000);
  }
}

// 👄 Lip Sync
function startLipSync(audio) {
  if (!bob) return;
  console.log("👄 Lip sync start");

  const talkMoves = [
    "Animation_Talk_with_Hands_Open_withSkin",
    "Animation_Talk_with_Left_Hand_Raised_withSkin",
    "Animation_Talk_with_Right_Hand_Open_withSkin"
  ];

  let index = 0;
  bob._lipSyncInterval = setInterval(() => {
    bob.src = `https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/${talkMoves[index]}.glb`;
    index = (index + 1) % talkMoves.length;
  }, 400);

  audio.addEventListener("ended", stopLipSync);
}

function stopLipSync() {
  if (!bob) return;
  clearInterval(bob._lipSyncInterval);
  bob.src = `https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/Animation_Long_Breathe_and_Look_Around_withSkin.glb`;
  console.log("👄 Lip sync stop");
}

// 💤 Random Idle Behavior
function randomIdleBehavior() {
  if (isTalking) return;

  const idleAnimations = [
    "Animation_Long_Breathe_and_Look_Around_withSkin",
    "Animation_Agree_Gesture_withSkin",
    "Animation_Alert_withSkin",
    "Animation_Shrug_withSkin",
    "Animation_Sleep_Normally_withSkin"
  ];

  const randomAnim = idleAnimations[Math.floor(Math.random() * idleAnimations.length)];
  playAnimation(randomAnim, 4000);
}
setInterval(randomIdleBehavior, 15000);

// 🎧 Speech Recognition Setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "en-US";
recognition.continuous = true;
recognition.interimResults = false;

recognition.onstart = () => console.log("🎙 Bob is listening...");
recognition.onerror = (event) => console.error("Speech recognition error:", event);
recognition.onend = () => {
  console.log("Recognition ended. Restarting in 2s...");
  setTimeout(() => recognition.start(), 2000);
};

recognition.onresult = async (event) => {
  const transcript = event.results[event.results.length - 1][0].transcript.trim();
  console.log("👂 You said:", transcript);
  if (transcript.length > 0) await talkToBob(transcript);
};

// 🚀 Init
window.addEventListener("DOMContentLoaded", () => {
  try {
    recognition.start();
    console.log("Bob’s alive and listenin’ again. 🤠");
  } catch (err) {
    console.error("Speech recognition start failed:", err);
  }
});
