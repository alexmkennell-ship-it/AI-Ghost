// bob.js — final polished build
// Smooth crossfade + mic listening + correct /tts endpoint + robust playback

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// --- Animation names ---
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

let mvA, mvB, activeMV, inactiveMV, statusEl;
let currentAnim = null;
let state = "boot";
const glbCache = new Map();
const inflight = new Map();

const setStatus = (msg) => {
  statusEl ??= document.getElementById("status");
  if (statusEl) statusEl.textContent = msg;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const doubleRaf = async () => {
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
};

// --- GLB loader ---
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

// --- Model loading + crossfade ---
async function waitForModelLoaded(mv) {
  if (mv?.model) { await doubleRaf(); return; }
  await new Promise((resolve) => {
    const onLoad = () => { mv.removeEventListener("load", onLoad); resolve(); };
    mv.addEventListener("load", onLoad, { once: true });
  });
  await doubleRaf();
}

async function setAnim(name, { minHoldMs = 800 } = {}) {
  if (!inactiveMV || !activeMV) return;
  const url = await ensureGlbUrl(name);
  inactiveMV.setAttribute("src", url);
  await waitForModelLoaded(inactiveMV);
  try { inactiveMV.currentTime = 0; await inactiveMV.play(); } catch {}
  inactiveMV.classList.add("active");
  activeMV.classList.remove("active");
  [activeMV, inactiveMV] = [inactiveMV, activeMV];
  currentAnim = name;
  if (minHoldMs > 0) await sleep(minHoldMs);
}

// --- Warmup ---
async function warmup() {
  const warm = new Set([ANIM.IDLE_MAIN, ANIM.SHRUG, ANIM.SLEEP, ...talkPool]);
  let delay = 100;
  for (const name of warm) {
    setTimeout(() => ensureGlbUrl(name).catch(() => {}), delay);
    delay += 100;
  }
}

// --- Idle refresh ---
let idleSwapTimer = null;
function scheduleIdleSwap() {
  clearTimeout(idleSwapTimer);
  idleSwapTimer = setTimeout(async () => {
    if (state === "idle") await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 1000 });
    scheduleIdleSwap();
  }, 12000 + Math.random() * 5000);
}

// --- Speech handling ---
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

    console.log("🎯 Fetching TTS from:", `${WORKER_URL}/tts`);
    const resp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ac.signal,
    });

    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength < 1000) {
      console.warn("⚠️ Worker returned short or invalid audio response.");
      setStatus("⚠️ Invalid audio response");
      return;
    }

    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = 1.0;

    // --- Robust playback handling ---
    const playAudio = async () => {
      try {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          await playPromise;
          return;
        }
      } catch (err) {
        console.warn("First play blocked:", err);
      }

      // 🔁 Fallback #1: quick silent user gesture hack
      try {
        const dummy = new Audio();
        dummy.muted = true;
        await dummy.play().catch(() => {});
        await new Promise((r) => setTimeout(r, 100));
        await audio.play();
        console.log("✅ Recovered from autoplay block");
        return;
      } catch (err) {
        console.warn("Silent gesture fallback failed:", err);
      }

      // 🔁 Fallback #2: explicit user click
      setStatus("👆 Click to hear Bob...");
      document.addEventListener(
        "click",
        () => {
          audio.play().then(() => {
            setStatus("💬 Playing response...");
          }).catch(console.error);
        },
        { once: true }
      );
    };
    await playAudio();

    audio.onended = async () => {
      URL.revokeObjectURL(url);
      state = "idle";
      setStatus("👂 Listening...");
      await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 600 });
    };
  } catch (err) {
    console.error("Speech error:", err);
    setStatus("⚠️ Speech error — see console");
    state = "idle";
  }
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

// --- Microphone ---
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = async (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.trim();
    if (transcript.length > 0) {
      console.log("🎤 Heard:", transcript);
      await speakAndAnimate(transcript);
    }
  };

  recognition.onerror = (e) => console.warn("Speech recognition error:", e.error);
  recognition.onend = () => { if (state === "idle") recognition.start(); };

  window.addEventListener("click", () => {
    try {
      recognition.start();
      setStatus("👂 Listening (mic on)...");
    } catch (err) {
      console.warn("Mic start error:", err);
    }
  }, { once: true });
} else {
  console.warn("SpeechRecognition not supported in this browser.");
}

// --- Boot sequence ---
async function boot() {
  try {
    console.log("🟢 Booting Bob...");
    statusEl = document.getElementById("status");
    mvA = document.getElementById("mvA");
    mvB = document.getElementById("mvB");

    if (!mvA || !mvB) {
      setStatus("Error: model-viewer not found");
      console.error("❌ Missing model-viewer elements!");
      return;
    }

    activeMV = mvA;
    inactiveMV = mvB;
    activeMV.classList.add("active");

    setStatus("Warming up…");
    await warmup();
    console.log("✅ Warmup complete");
    await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800 });

    state = "idle";
    setStatus("👂 Listening...");
    scheduleIdleSwap();

    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "p") {
        speakAndAnimate("Well now, partner—I'm a real pun slinger!");
      }
    });

    console.log("🎉 Bob ready!");
  } catch (err) {
    console.error("Boot error:", err);
    setStatus("⚠️ Failed to load Bob");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  console.log("📦 DOMContentLoaded — launching boot()");
  boot();
});

window.Bob = { setAnim, speak: speakAndAnimate, state: () => state };
