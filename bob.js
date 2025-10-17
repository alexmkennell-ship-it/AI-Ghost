// bob.js — smooth crossfade rewrite
//
// Key changes:
//  - Dual <model-viewer> instances crossfaded for seamless animation swaps
//  - Aggressive GLB preloading + objectURL cache
//  - Smarter talk/idle scheduler with minimum clip duration to avoid jitter
//  - Fewer layout thrashes via double-rAF gates on swaps
//
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// Animation names
const ANIM = {
  IDLE_MAIN: "Animation_Long_Breathe_and_Look_Around_withSkin",
  SLEEP: "Animation_Sleep_Normally_withSkin",
  ANGRY: "Animation_Angry_Ground_Stomp_withSkin",
  SHRUG: "Animation_Shrug_withSkin",
  TALK_1: "Animation_Talk_Passionately_withSkin",
  TALK_2: "Animation_Talk_with_Hands_Open_withSkin",
  TALK_3: "Animation_Explain_withSkin",
  TALK_4: "Animation_Excited_withSkin",
  YAWN: "Animation_Yawn_withSkin",
};

const idlePool = [ANIM.IDLE_MAIN];
const talkPool = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4];

// DOM
let mvA, mvB, activeMV, inactiveMV, statusEl;
let currentAnim = null;
let state = "boot"; // boot | idle | talking | sleeping

// Cache of preloaded GLBs
const glbCache = new Map(); // name -> objectURL
const inflight = new Map(); // name -> Promise<string>

function setStatus(msg) {
  statusEl ??= document.getElementById("status");
  if (statusEl) statusEl.textContent = msg;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function doubleRaf() {
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
}

async function ensureGlbUrl(name) {
  if (glbCache.has(name)) return glbCache.get(name);
  if (inflight.has(name)) return inflight.get(name);

  const p = (async () => {
    const res = await fetch(`${MODEL_BASE}${name}.glb`, { mode: "cors" });
    if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    glbCache.set(name, url);
    return url;
  })();

  inflight.set(name, p);
  try {
    return await p;
  } finally {
    inflight.delete(name);
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function waitForModelLoaded(mv) {
  if (mv?.model) {
    await doubleRaf();
    return;
  }
  await new Promise((resolve) => {
    const onLoad = () => {
      mv.removeEventListener("load", onLoad);
      resolve();
    };
    mv.addEventListener("load", onLoad, { once: true });
  });
  await doubleRaf();
}

async function setAnim(name, { minHoldMs = 800 } = {}) {
  if (!inactiveMV || !activeMV) return;

  const url = await ensureGlbUrl(name);

  inactiveMV.setAttribute("src", url);
  await waitForModelLoaded(inactiveMV);

  try {
    inactiveMV.currentTime = 0;
    await inactiveMV.play();
  } catch {}

  inactiveMV.classList.add("active");
  activeMV.classList.remove("active");

  [activeMV, inactiveMV] = [inactiveMV, activeMV];
  currentAnim = name;

  if (minHoldMs > 0) await sleep(minHoldMs);
}

async function warmup() {
  const warm = new Set([ANIM.IDLE_MAIN, ANIM.SHRUG, ANIM.SLEEP, ...talkPool]);
  let delay = 100;
  for (const name of warm) {
    setTimeout(() => { ensureGlbUrl(name).catch(() => {}); }, delay);
    delay += 100;
  }
}

let idleSwapTimer = null;
function scheduleIdleSwap() {
  clearTimeout(idleSwapTimer);
  idleSwapTimer = setTimeout(async () => {
    if (state === "idle") {
      await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 1000 });
    }
    scheduleIdleSwap();
  }, 12000 + Math.random() * 5000);
}

// --- Voice & talking ---
let abortSpeech = null;
async function speakAndAnimate(text) {
  if (!text) return;

  state = "talking";
  setStatus("💬 Talking...");
  const talkClip = pick(talkPool);
  await setAnim(talkClip, { minHoldMs: 900 });

  const ac = new AbortController();
  abortSpeech = () => ac.abort();

  const resp = await fetch(`${WORKER_URL}/talk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: ac.signal,
  });

  if (!resp.ok) throw new Error(`TTS failed: ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);

  const audio = new Audio(url);
  audio.playbackRate = 1.0;
  audio.onended = async () => {
    URL.revokeObjectURL(url);
    state = "idle";
    setStatus("👂 Listening...");
    await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 600 });
  };

  try {
    await audio.play();
  } catch {
    setStatus("👆 Click to allow audio");
    document.addEventListener("click", () => audio.play(), { once: true });
  }
}

function cancelSpeech() {
  if (abortSpeech) abortSpeech();
  abortSpeech = null;
}

// --- Inactivity ---
let lastActivity = Date.now();
function bumpActivity() { lastActivity = Date.now(); }

setInterval(async () => {
  const idleMs = Date.now() - lastActivity;
  if (state === "idle" && idleMs > 45000) {
    state = "sleeping";
    setStatus("😴 Sleeping...");
    await setAnim(ANIM.SLEEP, { minHoldMs: 1500 });
  }
}, 1000);

document.addEventListener("pointerdown", () => {
  bumpActivity();
  if (state === "sleeping") {
    state = "idle";
    setStatus("👂 Listening...");
    setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800 });
  }
}, { passive: true });

// --- Boot ---
async function boot() {
  statusEl = document.getElementById("status");
  mvA = document.getElementById("mvA");
  mvB = document.getElementById("mvB");
  activeMV = mvA;
  inactiveMV = mvB;
  activeMV.classList.add("active");

  setStatus("Warming up…");
  await warmup();
  await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800 });
  state = "idle";
  setStatus("👂 Listening...");
  scheduleIdleSwap();

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "p") {
      speakAndAnimate("Well now, partner—I'm a real pun slinger!");
    }
  });
}

window.addEventListener("DOMContentLoaded", boot);

window.Bob = { setAnim, speak: speakAndAnimate, state: () => state };
