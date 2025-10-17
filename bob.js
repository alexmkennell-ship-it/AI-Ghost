// bob.js — stable version (dynamic GLB + working mic)

const bob = document.getElementById("bob");
const statusEl = document.getElementById("status");
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// Animation names
const ANIM = {
  IDLE_MAIN: "Animation_Long_Breathe_and_Look_Around_withSkin",
  SLEEP: "Animation_Sleep_Normally_withSkin",
  WAKE: "Animation_Wake_Up_and_Look_Up_withSkin",
  STAND: "Animation_Stand_Up1_withSkin",
  WAVE: "Animation_Big_Wave_Hello_withSkin",
  ANGRY: "Animation_Angry_Ground_Stomp_withSkin",
  SHRUG: "Animation_Shrug_withSkin",
  TALK_1: "Animation_Talk_Passionately_withSkin",
  TALK_2: "Animation_Talk_with_Hands_Open_withSkin",
  TALK_3: "Animation_Talk_with_Left_Hand_Raised_withSkin",
  TALK_4: "Animation_Talk_with_Right_Hand_Open_withSkin",
  AGREE: "Animation_Agree_Gesture_withSkin",
  FUN_1: "Animation_Indoor_Play_withSkin",
  FUN_2: "Animation_Mummy_Stagger_withSkin",
  FUN_3: "Animation_Running_withSkin",
};

const idlePool = [ANIM.IDLE_MAIN, ANIM.FUN_1, ANIM.FUN_2, ANIM.FUN_3];
const talkPool = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4, ANIM.AGREE];

let state = "idle";
let lastActivity = Date.now();
let talkAnimTimer = null;
let sleepTimer = null;
let idleTimer = null;

const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
function bumpActivity() { lastActivity = Date.now(); }

// Wait until <model-viewer> finishes loading the new GLB
function waitForModelLoad(timeout = 5000) {
  return new Promise((resolve) => {
    if (!bob) {
      resolve();
      return;
    }

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      bob.removeEventListener("load", onLoad);
      bob.removeEventListener("error", onError);
      clearTimeout(timer);
      resolve();
    };

    const onLoad = () => {
      console.log("✅ Model loaded");
      cleanup();
    };

    const onError = (event) => {
      console.warn("⚠️ Model load error", event);
      cleanup();
    };

    const timer = setTimeout(() => {
      console.warn("⏱️ Model load timeout — continuing");
      cleanup();
    }, timeout);

    bob.addEventListener("load", onLoad, { once: true });
    bob.addEventListener("error", onError, { once: true });
  });
}

// Change animation safely
async function setAnim(name, holdMs = 0) {
  if (!bob) return;
  bob.src = `${MODEL_BASE}${name}.glb`;
  console.log("🎞️ Animation:", name);
  await waitForModelLoad();
  if (holdMs > 0) await sleep(holdMs);
}

// Idle cycle
function scheduleIdleSwap() {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (state !== "idle") return;
    const next = pick(idlePool);
    setAnim(next);
  }, rand(40000, 70000));
}

// Voice recognition
function startVoiceRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("❌ Speech recognition not supported in this browser.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => setStatus("👂 Listening...");
  recognition.onresult = async (event) => {
    const transcript =
      event.results[event.results.length - 1][0].transcript.trim();
    if (!transcript) return;
    bumpActivity();
    recognition.stop();
    await handleUserInput(transcript);
  };
  recognition.onerror = () => setStatus("⚠️ Mic error — restarting.");
  recognition.onend = () => setTimeout(() => recognition.start(), 1500);
  recognition.start();
}

// Chat + TTS
async function handleUserInput(userInput) {
  try {
    console.log("🎙️ User:", userInput);
    bumpActivity();
    state = "thinking";
    setStatus("🤔 Bob’s thinkin’...");
    await setAnim(ANIM.SHRUG, 1200);

    const chatResp = await fetch(`${WORKER_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput }),
    });
    const { reply } = await chatResp.json();
    console.log("💀 Bob:", reply);
    setStatus(reply || "(skeletal silence...)");

    const ttsResp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "sage" }),
    });
    const blob = await ttsResp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    state = "talking";
    startTalkingLoop();

    audio.onended = async () => {
      stopTalkingLoop();
      await setAnim(ANIM.IDLE_MAIN);
      state = "idle";
    };

    try {
      await audio.play();
    } catch {
      console.warn("⚠️ Autoplay blocked, waiting for click.");
      setStatus("👆 Click anywhere to let Bob speak.");
      document.body.addEventListener("click", () => audio.play(), { once: true });
    }
  } catch (err) {
    console.error("💀 Error talking to Bob:", err);
    setStatus("💀 Bob’s connection got spooked.");
  }
}

// Talking animation loop
function startTalkingLoop() {
  clearInterval(talkAnimTimer);
  talkAnimTimer = setInterval(() => {
    if (state !== "talking") return;
    setAnim(pick(talkPool));
  }, rand(1200, 2000));
}

function stopTalkingLoop() {
  clearInterval(talkAnimTimer);
  talkAnimTimer = null;
}

// Sleep mode
async function enterSleep() {
  if (state === "sleeping") return;
  state = "sleeping";
  setStatus("💤 Bob’s snoozin’...");
  await setAnim(ANIM.SLEEP);
}

// Wake up sequence (fixed)
async function wakeSequence(greet = true) {
  console.log("🌅 Bob waking up...");
  state = "waking";
  setStatus("🌅 Bob’s wakin’ up...");
  await setAnim(ANIM.WAKE, 2500);
  await setAnim(ANIM.STAND, 1500);
  if (greet) await setAnim(ANIM.WAVE, 1200);
  await setAnim(ANIM.IDLE_MAIN); // setAnim already waits for the model to load
  state = "idle";
  setStatus("🎙 Say somethin’, partner…");
  bumpActivity();
  scheduleIdleSwap();
  startVoiceRecognition();
}

// Boot sequence (overlay version)
window.addEventListener("DOMContentLoaded", () => {
  if (!bob) return;

  bob.addEventListener("load", async () => {
    console.log("✅ Bob ready!");
    setStatus("👆 Click to wake Bob up.");

    const overlay = document.getElementById("wakeOverlay");
    if (overlay) {
      overlay.addEventListener(
        "click",
        async () => {
          console.log("🖱️ Wake click detected");
          overlay.remove(); // remove overlay so model-viewer works again
          try { await new Audio().play().catch(() => {}); } catch {}
          await wakeSequence(true);
        },
        { once: true }
      );
    }
  });

  document.addEventListener("click", bumpActivity, { passive: true });
  document.addEventListener("keydown", bumpActivity, { passive: true });
});
