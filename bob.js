// bob.js — smooth crossfade + live microphone + reliable playback
//
// Full working version with active listening, smooth animation transitions,
// and hardened audio playback to prevent silent or blocked responses.
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
  TALK_3: "Animation_Talk_with_Left_Hand_Raised_withSkin",
  TALK_4: "Animation_Talk_with_Right_Hand_Open_withSkin",
  YAWN: "Animation_Yawn_withSkin",
};

const idlePool = [ANIM.IDLE_MAIN];
const talkPool = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4];

// DOM
let mvA, mvB, activeMV, inactiveMV, statusEl;
let currentAnim = null;
let state = "boot"; // boot | idle | talking | sleeping

// Cache of preloaded GLBs
const glbCache = new Map();
const inflight = new Map();

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

  try {
    state = "talking";
    setStatus("💬 Talking...");
    const talkClip = pick(talkPool);
    await setAnim(talkClip, { minHoldMs: 900 });

    const ac = new AbortController();
    abortSpeech = () => ac.abort();

    // Fetch TTS audio from worker
    const resp = await fetch(`${WORKER_URL}/talk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ac.signal,
    });

    if (!resp.ok) throw new Error(`TTS failed: ${resp.status}`);
    const blob = await resp.blob();

    // Convert blob -> playable audio URL
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = 1.0;

    // Safely play with click fallback
    const playAudio = async () => {
      try {
        await audio.play();
      } catch (err) {
        console.warn
