// bob.js — dynamic model swapping version (for separate GLBs per animation)

const bob = document.getElementById("bob");
const statusEl = document.getElementById("status");
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE =
  "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// ---------- Animation Definitions ----------
const ANIM = {
  IDLE_MAIN: "Animation_Long_Breathe_and_Look_Around_withSkin",
  SLEEP: "Animation_Sleep_Normally_withSkin",
  WAKE: "Animation_Wake_Up_and_Look_Up_withSkin",
  STAND: "Animation_Stand_Up1_withSkin",
  WAVE: "Animation_Big_Wave_Hello_withSkin",
  ALERT: "Animation_Alert_withSkin",
  ALERT_RIGHT: "Animation_Alert_Quick_Turn_Right_withSkin",
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

// ---------- Timers ----------
let state = "idle";
let lastActivity = Date.now();
let talkAnimTimer = null;
let sleepCheckTimer = null;
let funTimer = null;
let idleSwapTimer = null;

// ---------- Utility ----------
const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}
function bumpActivity() {
  lastActivity = Date.now();
}

// ---------- Dynamic Animation Loader ----------
async function setAnim(name, holdMs = 0) {
  if (!bob) return;
  bob.src = `${MODEL_BASE}${name}.glb`;
  console.log("🎞️ Playing:", name);
  if (holdMs > 0) await sleep(holdMs);
}

// ---------- Idle & Fun Behavior ----------
function scheduleIdleSwap() {
  clearInterval(idleSwapTimer);
  idleSwapTimer = setInterval(() => {
    if (state !== "idle") return;
    const next = pick(idlePool);
    setAnim(next);
  }, rand(40000, 70000));
}

function scheduleFunEvents() {
  clearTimeout(funTimer);
  funTimer = setTimeout(async () => {
    if (state === "idle") {
      const fun = pick([ANIM.FUN_1, ANIM.FUN_2, ANIM.FUN_3]);
      await setAnim(fun, 2500);
      await setAnim(ANIM.IDLE_MAIN);
    }
    scheduleFunEvents();
  }, rand(600000, 900000));
}

function scheduleSleepCheck() {
  clearInterval(sleepCheckTimer);
  sleepCheckTimer = setInterval(async () => {
    if (state !== "idle") return;
    const idleFor = Date.now() - lastActivity;
    if (idleFor >= 5 * 60_000) {
      await enterSleep();
    } else if (idleFor >= 4 * 60_000) {
      await setAnim(ANIM.AGREE, 1200);
      await setAnim(ANIM.IDLE_MAIN);
    }
  }, 10000);
}

// ---------- Talking Animation ----------
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
  setAnim(ANIM.IDLE_MAIN);
}

// ---------- Voice Recognition ----------
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

  recognition.onstart = () => setStatus("👂 Listening…");
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

// ---------- Chat + TTS ----------
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
    if (!chatResp.ok) throw new Error("Chat request failed");
    const { reply } = await chatResp.json();
    console.log("💀 Bob:", reply);
    setStatus(reply || "(skeletal silence…)");

    if (/hello|hi|howdy/i.test(reply)) await setAnim(ANIM.WAVE, 1200);
    else if (/angry|mad|heck/i.test(reply)) await setAnim(ANIM.ANGRY, 1200);
    else if (/shrug|unsure|maybe/i.test(reply)) await setAnim(ANIM.SHRUG, 1000);

    const ttsResp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "sage" }),
    });
    if (!ttsResp.ok) throw new Error(`TTS failed: ${ttsResp.status}`);
    const blob = await ttsResp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    state = "talking";
    audio.onplay = () => {
      startTalkingLoop();
    };
    audio.onended = async () => {
      stopTalkingLoop();
      bumpActivity();
      await setAnim(ANIM.IDLE_MAIN);
      state = "idle";
    };

    try {
      await audio.play();
    } catch {
      console.warn("⚠️ Autoplay blocked, waiting for click.");
      setStatus("👆 Click anywhere to let Bob speak.");
      document.body.addEventListener(
        "click",
        () => audio.play().catch(() => {}),
        { once: true }
      );
    }
  } catch (err) {
    console.error("💀 Error:", err);
    setStatus("💀 Bob’s connection got spooked.");
  }
}

// ---------- Sleep / Wake ----------
async function enterSleep() {
  if (state === "sleeping") return;
  console.log("💤 Bob going to sleep...");
  state = "sleeping";
  setStatus("💤 Bob’s snoozin’...");
  await setAnim(ANIM.SLEEP);
}

async function wakeSequence(greet = true) {
  console.log("🌅 Bob waking up...");
  state = "waking";
  setStatus("🌅 Bob’s waking up...");
  await setAnim(ANIM.WAKE, 2500);
  await setAnim(ANIM.STAND, 1500);
  if (greet) await setAnim(ANIM.WAVE, 1200);
  await setAnim(ANIM.IDLE_MAIN);
  state = "idle";
  setStatus("🎙 Say somethin’, partner…");
  bumpActivity();
  scheduleIdleSwap();
  scheduleFunEvents();
  scheduleSleepCheck();
  startVoiceRecognition();
}

// ---------- Boot ----------
window.addEventListener("DOMContentLoaded", () => {
  if (!bob) return;
  bob.addEventListener("load", async () => {
    console.log("✅ Bob ready!");
    setStatus("👆 Click to wake Bob up.");
    document.body.addEventListener(
      "click",
      async () => {
        try {
          await new Audio().play().catch(() => {});
        } catch {}
        await wakeSequence(true);
      },
      { once: true }
    );
  });

  document.addEventListener("click", bumpActivity, { passive: true });
  document.addEventListener("keydown", bumpActivity, { passive: true });
});
