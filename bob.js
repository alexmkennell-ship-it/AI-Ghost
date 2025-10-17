// bob.js — Bob the Bone Cowboy: full life-cycle + Sage TTS

const bob = document.getElementById("bob");
const statusEl = document.getElementById("status");
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";

// ---------- Animation Sets ----------
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

const idlePool = [ANIM.IDLE_MAIN, ANIM.FUN_2, ANIM.FUN_3, ANIM.FUN_1];
const talkPool = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4, ANIM.AGREE];

// ---------- Timings (tweak to taste) ----------
const IDLE_SWAP_MIN_MS = 40_000;
const IDLE_SWAP_MAX_MS = 70_000;
const FUN_EVENT_MIN_MS = 10 * 60_000; // every 10–15 min
const FUN_EVENT_MAX_MS = 15 * 60_000;
const THINKING_SWAP_MS  = 1800;
const TALK_SWAP_MIN_MS  = 1200;
const TALK_SWAP_MAX_MS  = 2000;
const TIME_TO_SLEEP_MS  = 5 * 60_000;  // 5 minutes to fall asleep
const TIME_TO_YAWN_MS   = 4 * 60_000;  // yawn/gesture before sleep
const SLEEP_CHECK_MS    = 10_000;

// ---------- State ----------
let state = "idle"; // "idle" | "waking" | "thinking" | "talking" | "sleeping"
let lastActivity = Date.now();
let idleSwapTimer = null;
let funTimer = null;
let sleepCheckTimer = null;
let talkAnimTimer = null;
let thinkAnimTimer = null;

// ---------- Utils ----------
const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

async function setAnim(name, holdMs = 0) {
  if (!bob) return;
  bob.animationName = name;
  if (holdMs > 0) await sleep(holdMs);
}

function bumpActivity() {
  lastActivity = Date.now();
}

// ---------- Cycles ----------
function scheduleIdleSwap() {
  clearInterval(idleSwapTimer);
  const period = rand(IDLE_SWAP_MIN_MS, IDLE_SWAP_MAX_MS);
  idleSwapTimer = setInterval(() => {
    if (state !== "idle") return;
    const next = pick(idlePool);
    console.log("🕰️ Idle swap →", next);
    setAnim(next);
  }, period);
}

function scheduleFunEvents() {
  clearTimeout(funTimer);
  const period = rand(FUN_EVENT_MIN_MS, FUN_EVENT_MAX_MS);
  funTimer = setTimeout(async () => {
    if (state === "idle") {
      const fun = pick([ANIM.FUN_1, ANIM.FUN_2, ANIM.FUN_3]);
      console.log("🎉 Fun event →", fun);
      await setAnim(fun, 2500);
      await setAnim(ANIM.IDLE_MAIN);
    }
    scheduleFunEvents();
  }, period);
}

function scheduleSleepCheck() {
  clearInterval(sleepCheckTimer);
  sleepCheckTimer = setInterval(async () => {
    if (state !== "idle") return;
    const idleFor = Date.now() - lastActivity;

    if (idleFor >= TIME_TO_SLEEP_MS) {
      await enterSleep();
    } else if (idleFor >= TIME_TO_YAWN_MS) {
      // small cue before sleeping
      console.log("🥱 Pre-sleep cue");
      await setAnim(ANIM.AGREE, 1200); // little stretch/nod
      await setAnim(ANIM.IDLE_MAIN);
    }
  }, SLEEP_CHECK_MS);
}

// ---------- Thinking / Talking Anim Loops ----------
function startThinkingLoop() {
  clearInterval(thinkAnimTimer);
  thinkAnimTimer = setInterval(() => {
    if (state !== "thinking") return;
    // bounce between shrug and subtle look-around
    bob.animationName =
      bob.animationName === ANIM.SHRUG ? ANIM.IDLE_MAIN : ANIM.SHRUG;
  }, THINKING_SWAP_MS);
}

function stopThinkingLoop() {
  clearInterval(thinkAnimTimer);
  thinkAnimTimer = null;
}

function startTalkingLoop() {
  clearInterval(talkAnimTimer);
  talkAnimTimer = setInterval(() => {
    if (state !== "talking") return;
    bob.animationName = pick(talkPool);
  }, rand(TALK_SWAP_MIN_MS, TALK_SWAP_MAX_MS));
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
    const transcript = event.results[event.results.length - 1][0].transcript.trim();
    if (!transcript) return;
    bumpActivity();
    recognition.stop(); // avoid overlapping events
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
    await thinkingOn();

    // 1) Ask Worker for reply
    const chatResp = await fetch(`${WORKER_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput }),
    });
    if (!chatResp.ok) throw new Error("Chat request failed");
    const { reply } = await chatResp.json();
    console.log("💀 Bob:", reply);
    setStatus(reply || "(skeletal silence…)");

    // Reaction cues (optional keywords)
    if (/shrug|unsure|maybe|don't know/i.test(reply)) await setAnim(ANIM.SHRUG, 900);
    else if (/hello|hi|howdy/i.test(reply)) await setAnim(ANIM.WAVE, 1200);
    else if (/mad|angry|heck|dang/i.test(reply)) await setAnim(ANIM.ANGRY, 1000);

    // 2) TTS (Sage voice)
    const ttsResp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "sage" }),
    });
    if (!ttsResp.ok) throw new Error(`TTS failed: ${ttsResp.status}`);
    const blob = await ttsResp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    // 3) Talking animations while audio plays
    await talkingOn(audio);
  } catch (err) {
    console.error("💀 Error:", err);
    setStatus("💀 Bob’s connection got spooked.");
    await idleOn();
  }
}

// ---------- Mode Helpers ----------
async function thinkingOn() {
  state = "thinking";
  stopTalkingLoop();
  setStatus("🤔 Bob’s thinkin’…");
  await setAnim(ANIM.SHRUG);
  startThinkingLoop();
}

async function talkingOn(audio) {
  stopThinkingLoop();
  state = "talking";
  setStatus("🎧 Bob's talkin’ now!");
  startTalkingLoop();

  audio.onended = async () => {
    bumpActivity();
    stopTalkingLoop();
    await idleOn();
  };

  try {
    await audio.play();
  } catch {
    console.warn("⚠️ Autoplay blocked, waiting for click to start audio.");
    setStatus("👆 Click anywhere to let Bob speak.");
    document.body.addEventListener(
      "click",
      () => audio.play().catch(()=>{}),
      { once: true }
    );
  }
}

async function idleOn() {
  state = "idle";
  setStatus("🎙 Say somethin’, partner…");
  await setAnim(ANIM.IDLE_MAIN);
  scheduleIdleSwap();
  // keep fun & sleep watchers rolling
}

async function enterSleep() {
  if (state === "sleeping") return;
  console.log("😴 Entering sleep…");
  state = "sleeping";
  setStatus("💤 Bob’s snoozin’…");
  stopThinkingLoop();
  stopTalkingLoop();
  await setAnim(ANIM.SLEEP);
}

async function wakeSequence(greet = true) {
  if (state === "waking") return;
  state = "waking";
  setStatus("🌅 Bob’s waking up…");
  await setAnim(ANIM.WAKE, 2500);
  await setAnim(ANIM.STAND, 1500);
  if (greet) await setAnim(ANIM.WAVE, 1200);
  await idleOn();
  bumpActivity();
}

// ---------- Boot ----------
window.addEventListener("DOMContentLoaded", () => {
  if (!bob) return;

  bob.addEventListener("load", async () => {
    console.log("✅ Bob ready!");
    // Start “click to wake” UX if no prompt widget exists
    if (!document.getElementById("startPrompt")) {
      setStatus("👆 Click to wake Bob up.");
      document.body.addEventListener(
        "click",
        async () => {
          // prime audio permission
          try { await new Audio().play().catch(()=>{}); } catch {}
          await wakeSequence(true);
          startVoiceRecognition();
        },
        { once: true }
      );
    } else {
      // If your page has a prompt box that calls startVoiceRecognition already,
      // we'll just prep wake sequence on first click handled elsewhere.
      setStatus("🎙 Say somethin’, partner…");
    }

    // Start background cycles
    scheduleIdleSwap();
    scheduleFunEvents();
    scheduleSleepCheck();
  });

  // Any click counts as "activity" (resets sleep timer)
  document.addEventListener("click", () => bumpActivity(), { passive: true });
  document.addEventListener("keydown", () => bumpActivity(), { passive: true });
});
