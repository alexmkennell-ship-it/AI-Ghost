// bob.js — Final Smart + Synced + Expressive
// - No-ghost sequential fades
// - Talk animation starts exactly on audio.onplay
// - Talk loops for the whole audio duration
// - Jaw + fingers driven by live audio amplitude (if bones found)

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
let state = "boot";
const glbCache = new Map();
const inflight = new Map();

// expressive driver state
let audioCtx = null;
let analyser = null;
let srcNode = null;
let amplitudeRAF = 0;
let jawBone = null;
let fingerBones = [];
let boneSearchDone = false;

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

// --- Wait for model ---
async function waitForModelLoaded(mv) {
  if (mv?.model) { await doubleRaf(); return; }
  await new Promise((resolve) => {
    const onLoad = () => { mv.removeEventListener("load", onLoad); resolve(); };
    mv.addEventListener("load", onLoad, { once: true });
  });
  await doubleRaf();
}

/* -------------------------------------------------------
   Smooth transition helper (sequential fade — no overlap)
   1) Fade OUT active
   2) Swap src on inactive + load
   3) Fade IN inactive
------------------------------------------------------- */
async function setAnim(name, { minHoldMs = 800, blendMs = 600 } = {}) {
  if (!inactiveMV || !activeMV) return;

  // Step 1: fade out current (no new model visible yet)
  activeMV.classList.remove("active"); // triggers opacity:0 on active
  await sleep(blendMs);

  // Step 2: prepare next on hidden layer
  const url = await ensureGlbUrl(name);
  inactiveMV.setAttribute("src", url);
  await waitForModelLoaded(inactiveMV);
  try { inactiveMV.currentTime = 0; await inactiveMV.play(); } catch {}

  // Step 3: fade in the new one
  inactiveMV.classList.add("active");
  await sleep(blendMs);

  // swap refs (cleanup classes so inactive is neutral)
  activeMV.classList.remove("inactive");
  inactiveMV.classList.remove("inactive");
  [activeMV, inactiveMV] = [inactiveMV, activeMV];

  if (minHoldMs > 0) await sleep(minHoldMs);
}

// --- Preload animations ---
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

/* -------------------------------------------------------
   Bone discovery (best-effort, safe)
   We traverse the internal Three.js scene and find bones
   by fuzzy name match. Works across exports.
------------------------------------------------------- */
function getThreeScene(mv) {
  // try common hooks used by <model-viewer>
  // these are not public API but commonly present
  return (
    mv?.model?.scene ||          // often works
    mv?.scene ||                 // sometimes available
    mv?.[$scene] ||              // internal symbol
    null
  );
}

function fuzzyBoneFind(scene) {
  if (!scene) return { jaw: null, fingers: [] };
  let jaw = null;
  const fingers = [];
  const jawRegex = /jaw|chin/i;
  const fingerRegex = /finger|index|middle|ring|pinky|thumb/i;
  const handRegex = /hand|wrist/i;

  scene.traverse?.((obj) => {
    const n = obj.name || "";
    if (!jaw && jawRegex.test(n)) jaw = obj;
    if (fingerRegex.test(n) || handRegex.test(n)) fingers.push(obj);
  });

  return { jaw, fingers };
}

function ensureBonesBound() {
  if (boneSearchDone) return;
  const scene = getThreeScene(activeMV);
  if (!scene) return;

  const { jaw, fingers } = fuzzyBoneFind(scene);
  jawBone = jaw || null;
  // cap finger list to a handful of useful bones to avoid overdriving
  fingerBones = (fingers || []).slice(0, 6);
  boneSearchDone = true;

  console.log("🦴 Bones:", {
    jaw: jawBone?.name || "not found",
    fingers: fingerBones.map(b => b.name),
  });
}

/* -------------------------------------------------------
   Mouth + fingers driver using audio amplitude
------------------------------------------------------- */
function startAmplitudeDriveFor(audio) {
  stopAmplitudeDrive();

  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    const src = audioCtx.createMediaElementSource(audio);
    srcNode = src;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);

    const data = new Uint8Array(analyser.fftSize);
    const baseJaw = { value: 0 }; // for smoothing
    const baseFinger = { value: 0 };

    const drive = () => {
      analyser.getByteTimeDomainData(data);
      // compute normalized amplitude (0..1)
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const amp = Math.min(1, rms * 6); // boost a bit, clamp

      // smooth (lerp)
      baseJaw.value = baseJaw.value * 0.7 + amp * 0.3;
      baseFinger.value = baseFinger.value * 0.8 + amp * 0.2;

      // bind bones if not already
      ensureBonesBound();

      // drive jaw rotation (open downward: rotate around X if present)
      if (jawBone && jawBone.rotation) {
        const open = baseJaw.value * 0.35; // ~20 degrees max
        jawBone.rotation.x = -open; // open jaw down
      }

      // subtle finger flex (rotate small amounts)
      if (fingerBones.length) {
        const bend = baseFinger.value * 0.25; // gentle
        for (const b of fingerBones) {
          if (b.rotation) {
            b.rotation.x = (b.rotation.x || 0) - bend * 0.15;
            b.rotation.z = (b.rotation.z || 0) + bend * 0.05;
          }
        }
      }

      amplitudeRAF = requestAnimationFrame(drive);
    };

    amplitudeRAF = requestAnimationFrame(drive);
  } catch (e) {
    console.warn("Audio analysis unavailable:", e);
  }
}

function stopAmplitudeDrive() {
  if (amplitudeRAF) cancelAnimationFrame(amplitudeRAF);
  amplitudeRAF = 0;
  try {
    if (srcNode) srcNode.disconnect();
    if (analyser) analyser.disconnect();
  } catch {}
  srcNode = null;
  analyser = null;
}

/* -------------------------------------------------------
   Voice & talking (AI smart + synced to audio start)
------------------------------------------------------- */
let abortSpeech = null;
async function speakAndAnimate(userText) {
  if (!userText) return;

  try {
    state = "talking";
    setStatus("💬 Thinking...");

    // Step 1 — get AI reply first (no talk anim yet)
    const chatResp = await fetch(`${WORKER_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userText }),
    });
    const data = await chatResp.json();
    const replyText = data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖 Bob says:", replyText);

    // Step 2 — convert reply to audio
    const ac = new AbortController();
    abortSpeech = () => ac.abort();

    const resp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText }),
      signal: ac.signal,
    });

    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength < 1000) {
      console.warn("⚠️ Worker returned short or invalid audio response.");
      setStatus("⚠️ Invalid audio response");
      state = "idle";
      return;
    }

    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = 1.0;

    // When audio actually starts, kick talk animation + amplitude driving
    let talkStarted = false;
    const onPlay = async () => {
      if (talkStarted) return;
      talkStarted = true;

      // pick a talk clip and keep re-applying it to cover full duration
      const talkClip = pick(talkPool);
      const blendMs = 400;

      // ensure bones can be found for the current active model
      boneSearchDone = false;
      ensureBonesBound();

      // start talk clip exactly on audio play
      await setAnim(talkClip, { minHoldMs: 0, blendMs });

      // loop/refresh talk for the whole audio duration
      const ensureTalking = () => {
        if (state !== "talking") return;
        // re-issue the same talk anim every ~2.2s to avoid end jitter
        setTimeout(() => {
          if (state === "talking") setAnim(talkClip, { minHoldMs: 0, blendMs });
          ensureTalking();
        }, 2200);
      };
      ensureTalking();

      // start mouth/finger driving
      startAmplitudeDriveFor(audio);
    };

    audio.addEventListener("play", onPlay, { once: true });

    // Robust playback (autoplay restrictions)
    const playAudio = async () => {
      try {
        const playPromise = audio.play();
        if (playPromise !== undefined) await playPromise;
        return;
      } catch (err) {
        console.warn("First play blocked:", err);
      }

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
      stopAmplitudeDrive();
      URL.revokeObjectURL(url);
      state = "idle";
      setStatus("👂 Listening...");
      await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 600, blendMs: 500 });
    };
  } catch (err) {
    console.error("Speech error:", err);
    stopAmplitudeDrive();
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
    await setAnim(ANIM.SLEEP, { minHoldMs: 1500, blendMs: 600 });
  }
}, 1000);
document.addEventListener("pointerdown", () => {
  bumpActivity();
  if (state === "sleeping") {
    state = "idle";
    setStatus("👂 Listening...");
    setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800, blendMs: 500 });
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
} else console.warn("SpeechRecognition not supported.");

// --- Boot ---
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
    activeMV.classList.add("active");      // visible
    inactiveMV.classList.remove("active"); // hidden

    setStatus("Warming up…");
    await warmup();
    console.log("✅ Warmup complete");
    await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800, blendMs: 500 });

    state = "idle";
    setStatus("👂 Listening...");
    scheduleIdleSwap();

    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "p") {
        speakAndAnimate("Howdy partner! Ready to rustle up some mischief?");
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
