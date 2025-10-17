// bob.js — Expressive Build 3.3 “Cinematic Focus Stable”
// • 5.8 m base orbit, 7.2 m sleep dolly
// • Auto head focus + drift
// • Unified smooth transitions
// • Fully self-contained (no missing utils)

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// ---------- Animation map ----------
const ANIM = {
  IDLE_MAIN: "Animation_Long_Breathe_and_Look_Around_withSkin",
  IDLE_PLAY: "Animation_Indoor_Play_withSkin",
  IDLE_STAG: "Animation_Mummy_Stagger_withSkin",
  IDLE_RUN: "Animation_Running_withSkin",
  WALK: "Animation_Walking_withSkin",
  SLEEP: "Animation_Sleep_Normally_withSkin",
  WAKE_UP: "Animation_Wake_Up_and_Look_Up_withSkin",
  STAND_UP: "Animation_Stand_Up1_withSkin",
  ALERT: "Animation_Alert_withSkin",
  ALERT_R: "Animation_Alert_Quick_Turn_Right_withSkin",
  SHRUG: "Animation_Shrug_withSkin",
  AGREE: "Animation_Agree_Gesture_withSkin",
  ANGRY: "Animation_Angry_Ground_Stomp_withSkin",
  TANTRUM: "Animation_Angry_To_Tantrum_Sit_withSkin",
  TALK_1: "Animation_Talk_Passionately_withSkin",
  TALK_2: "Animation_Talk_with_Hands_Open_withSkin",
  TALK_3: "Animation_Talk_with_Left_Hand_Raised_withSkin",
  TALK_4: "Animation_Talk_with_Right_Hand_Open_withSkin"
};

const talkPool = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4];
const idlePool = [ANIM.IDLE_MAIN, ANIM.IDLE_PLAY, ANIM.IDLE_STAG, ANIM.IDLE_RUN, ANIM.WALK];
const alertPool = [ANIM.ALERT, ANIM.ALERT_R];

// ---------- Core globals ----------
let mvA, mvB, activeMV, inactiveMV, statusEl;
let state = "boot", micLocked = false, animLock = false, sleepLock = false;
let lastActivity = Date.now();
const glbCache = new Map(), inflight = new Map();

// ---------- Helpers ----------
const setStatus = (m) => (statusEl ??= document.getElementById("status")) && (statusEl.textContent = m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const doubleRaf = async () => { await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r)); };

// ---------- Camera ----------
let camDriftRAF = 0, camDriftActive = false, camYawBase = 0;
let focusRAF = 0, focusActive = false, focusBone = null;

function setCameraOrbitImmediate(orbitStr) {
  if (!activeMV) return;
  activeMV.setAttribute("camera-orbit", orbitStr);
  const parts = orbitStr.split(" ");
  camYawBase = parseFloat(parts[0]) || 0;
}

async function smoothCameraTransition(targetRadius, duration = 1000) {
  const mv = activeMV; if (!mv) return;
  const orbit = mv.getAttribute("camera-orbit") || "0deg 75deg 5.8m";
  const parts = orbit.split(" ");
  const currentRadius = parseFloat(parts[2]) || 5.8;
  const start = clamp(currentRadius, 5.8, 8.0);
  const end = clamp(targetRadius, 5.8, 8.0);
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min((t - t0) / duration, 1);
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * k);
    const r = lerp(start, end, eased);
    const out = `${camYawBase.toFixed(2)}deg 75deg ${r.toFixed(2)}m`;
    mv.setAttribute("camera-orbit", out);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function startCamDrift() {
  if (camDriftRAF) return;
  camDriftActive = true;
  const base = camYawBase;
  const startT = performance.now();
  const tick = (t) => {
    if (!camDriftActive || state !== "idle") { camDriftRAF = requestAnimationFrame(tick); return; }
    const elapsed = (t - startT) / 1000;
    const yaw = base + Math.sin(elapsed * 0.15) * 5;
    const orbit = activeMV?.getAttribute("camera-orbit") || "0deg 75deg 5.8m";
    const parts = orbit.split(" ");
    const radius = parts[2] || "5.8m";
    activeMV?.setAttribute("camera-orbit", `${yaw.toFixed(2)}deg 75deg ${radius}`);
    camDriftRAF = requestAnimationFrame(tick);
  };
  camDriftRAF = requestAnimationFrame(tick);
}
function stopCamDrift() { camDriftActive = false; if (camDriftRAF) cancelAnimationFrame(camDriftRAF); camDriftRAF = 0; }

function startFocusTracking() {
  if (focusRAF) return;
  focusActive = true;
  const tick = () => {
    if (!focusActive || !activeMV?.model?.scene) { focusRAF = requestAnimationFrame(tick); return; }
    try {
      if (!focusBone) activeMV.model.scene.traverse((o) => { if (/head|neck|spine2/i.test(o.name)) focusBone = o; });
      if (focusBone?.getWorldPosition && window.THREE) {
        const pos = focusBone.getWorldPosition(new THREE.Vector3());
        activeMV.setAttribute("camera-target", `${pos.x.toFixed(2)}m ${pos.y.toFixed(2)}m ${pos.z.toFixed(2)}m`);
      } else {
        activeMV.setAttribute("camera-target", "0m 1.2m 0m");
      }
    } catch {}
    focusRAF = requestAnimationFrame(tick);
  };
  focusRAF = requestAnimationFrame(tick);
}
function stopFocusTracking() { focusActive = false; if (focusRAF) cancelAnimationFrame(focusRAF); focusRAF = 0; focusBone = null; }

// ---------- Loader ----------
async function ensureGlbUrl(name) {
  if (glbCache.has(name)) return glbCache.get(name);
  if (inflight.has(name)) return inflight.get(name);
  const p = (async () => {
    let res = await fetch(`${MODEL_BASE}${name}.glb`, { mode: "cors" });
    if (!res.ok) {
      console.warn("Missing model:", name);
      res = await fetch(`${MODEL_BASE}${ANIM.IDLE_MAIN}.glb`, { mode: "cors" });
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    glbCache.set(name, url);
    return url;
  })();
  inflight.set(name, p);
  try { return await p; } finally { inflight.delete(name); }
}
async function waitForModelLoaded(mv) {
  if (mv?.model) { await doubleRaf(); return; }
  await new Promise((res) => {
    const on = () => { mv.removeEventListener("load", on); res(); };
    mv.addEventListener("load", on, { once: true });
  });
  await doubleRaf();
}

// ---------- Animations ----------
async function setAnim(name, { minHoldMs = 700, blendMs = 400 } = {}) {
  if (animLock) return;
  animLock = true;
  try {
    activeMV.classList.remove("active");
    await sleep(blendMs);
    const url = await ensureGlbUrl(name);
    inactiveMV.setAttribute("src", url);
    await waitForModelLoaded(inactiveMV);
    try { inactiveMV.currentTime = 0; await inactiveMV.play(); } catch {}
    inactiveMV.classList.add("active");
    await sleep(blendMs);
    [activeMV, inactiveMV] = [inactiveMV, activeMV];
    if (minHoldMs > 0) await sleep(minHoldMs);
  } finally { animLock = false; }
}

// ---------- Speech ----------
async function speakAndAnimate(userText) {
  if (!userText) return;
  try {
    state = "talking";
    stopCamDrift();
    setStatus("💬 Thinking...");
    const resp = await fetch(`${WORKER_URL}/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userText })
    });
    const data = await resp.json();
    const reply = data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖 Bob says:", reply);

    const tts = await fetch(`${WORKER_URL}/tts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "onyx" })
    });
    if (!tts.ok) { setStatus("⚠️ TTS failed"); state = "idle"; startCamDrift(); return; }
    const buf = await tts.arrayBuffer();
    const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
    audio.playbackRate = 0.9; audio.preservesPitch = false;

    micLocked = true; if (window.recognition) try { window.recognition.stop(); } catch {}
    audio.addEventListener("play", async () => { await setAnim(pick(talkPool), { blendMs: 250 }); }, { once: true });
    await audio.play().catch(() => {});
    audio.onended = async () => {
      micLocked = false; if (window.recognition) try { window.recognition.start(); } catch {}
      state = "idle"; setStatus("👂 Listening...");
      await setAnim(ANIM.IDLE_MAIN, { blendMs: 400 });
      startCamDrift();
    };
  } catch (e) {
    console.error("Speech error:", e);
    state = "idle"; startCamDrift();
  }
}

// ---------- Sleep / Wake ----------
async function enterSleep() {
  if (state !== "idle" || sleepLock) return;
  sleepLock = true;
  state = "sleeping";
  stopCamDrift();
  stopFocusTracking();
  setStatus("😴 Nodding off…");
  await smoothCameraTransition(7.2, 1200);
  await setAnim(ANIM.SLEEP, { minHoldMs: 1800 });
}
async function standUpSequence() {
  await smoothCameraTransition(5.8, 1000);
  await setAnim(ANIM.WAKE_UP, { minHoldMs: 400 });
  await setAnim(ANIM.STAND_UP, { minHoldMs: 500 });
  await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800 });
  startCamDrift();
  startFocusTracking();
  state = "idle";
  sleepLock = false;
  setStatus("👂 Listening...");
}

// ---------- Idle variety ----------
function scheduleIdleVariety() {
  const delay = 15000 + Math.random() * 10000;
  setTimeout(async () => {
    if (state !== "idle") { scheduleIdleVariety(); return; }
    const r = Math.random();
    let anim = ANIM.IDLE_MAIN;
    if (r < 0.05) anim = pick(alertPool);
    else if (r < 0.2) anim = ANIM.IDLE_PLAY;
    else if (r < 0.4) anim = pick([ANIM.IDLE_STAG, ANIM.IDLE_RUN, ANIM.WALK]);
    else anim = ANIM.IDLE_MAIN;
    await setAnim(anim, { blendMs: 300 });
    if (Math.random() < 0.1) await enterSleep();
    scheduleIdleVariety();
  }, delay);
}

// ---------- Microphone ----------
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition) {
  const rec = new SpeechRecognition(); rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
  window.recognition = rec;
  rec.onresult = async (e) => {
    const t = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    if (!t) return;
    console.log("🎤 Heard:", t);
    if (state === "sleeping" && /hey\s*bob/.test(t)) { await standUpSequence(); return; }
    await speakAndAnimate(t);
  };
  rec.onerror = (e) => console.warn("Speech recognition error:", e.error);
  rec.onend = () => { if (!micLocked && state !== "sleeping") rec.start(); };
  window.addEventListener("click", () => { try { rec.start(); setStatus("👂 Listening (mic on)..."); } catch {} }, { once: true });
} else console.warn("SpeechRecognition not supported.");

// ---------- Warmup ----------
async function warmup() {
  const warm = new Set([ANIM.IDLE_MAIN, ANIM.SHRUG, ANIM.SLEEP, ANIM.WAKE_UP, ANIM.STAND_UP, ...talkPool, ...idlePool]);
  let d = 100;
  for (const n of warm) { setTimeout(() => ensureGlbUrl(n).catch(() => {}), d); d += 100; }
}

// ---------- Boot ----------
async function boot() {
  try {
    console.log("🟢 Booting Bob...");
    statusEl = document.getElementById("status");
    mvA = document.getElementById("mvA");
    mvB = document.getElementById("mvB");
    if (!mvA || !mvB) { setStatus("Error: model-viewer not found"); return; }
    activeMV = mvA; inactiveMV = mvB; activeMV.classList.add("active");
    setCameraOrbitImmediate("0deg 75deg 5.8m");
    activeMV.setAttribute("camera-target", "0m 1.2m 0m");
    setStatus("Warming up…");
    await warmup();
    console.log("✅ Warmup complete");
    await setAnim(ANIM.IDLE_MAIN);
    state = "idle";
    startCamDrift();
    startFocusTracking();
    scheduleIdleVariety();
    document.addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "p") speakAndAnimate("Howdy partner!"); });
    console.log("🎉 Bob ready!");
  } catch (e) {
    console.error("Boot error:", e);
    setStatus("⚠️ Failed to load Bob");
  }
}
window.addEventListener("DOMContentLoaded", () => { console.log("📦 DOMContentLoaded — launching boot()"); boot(); });
