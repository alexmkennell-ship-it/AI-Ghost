// bob.js — Expressive Build 2.1 (FULL)
// ✅ No-ghost sequential fades
// ✅ Talk anim starts exactly with audio
// ✅ Mic lock during playback (no self-echo)
// ✅ Jaw + fingers driven by audio amplitude (Web Audio)
// ✅ Eye glow reacts to emotion keywords
// ✅ Micro-idle gestures so Bob feels alive
// ✅ Deeper, raspy cowboy voice ("copper", 0.9× speed)

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

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

// expressive state
let audioCtx = null, analyser = null, srcNode = null, amplitudeRAF = 0;
let jawBone = null, fingerBones = [], eyeMeshes = [];
let boneSearchDone = false, eyeSearchDone = false;
let microIdleRAF = 0, microIdleTimer = 0, microIdleActive = false;

// mic lock to prevent self-echo
let micLocked = false;
// expose recognition so we can stop/start it
window.recognition = null;

// ----------------- utils -----------------
const setStatus = (msg) => {
  statusEl ??= document.getElementById("status");
  if (statusEl) statusEl.textContent = msg;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const doubleRaf = async () => {
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
};

// ----------------- GLB loader -----------------
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

// ----------------- model-viewer helpers -----------------
async function waitForModelLoaded(mv) {
  if (mv?.model) { await doubleRaf(); return; }
  await new Promise((resolve) => {
    const onLoad = () => { mv.removeEventListener("load", onLoad); resolve(); };
    mv.addEventListener("load", onLoad, { once: true });
  });
  await doubleRaf();
}

function getThreeScene(mv) {
  // Typically available from <model-viewer> instance
  return mv?.model?.scene || mv?.scene || null;
}

// ----------------- bone / eye discovery -----------------
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

function fuzzyEyeFind(scene) {
  if (!scene) return [];
  const eyes = [];
  const eyeRegex = /eye|pupil|iris/i;
  scene.traverse?.((obj) => {
    const n = obj.name || "";
    if (eyeRegex.test(n) && obj.material) eyes.push(obj);
  });
  return eyes.slice(0, 4);
}

function ensureBindings() {
  const scene = getThreeScene(activeMV);
  if (!scene) return;

  if (!boneSearchDone) {
    const { jaw, fingers } = fuzzyBoneFind(scene);
    jawBone = jaw || null;
    fingerBones = (fingers || []).slice(0, 6);
    boneSearchDone = true;
    console.log("🦴 Bones:", {
      jaw: jawBone?.name || "not found",
      fingers: fingerBones.map(b => b.name),
    });
  }
  if (!eyeSearchDone) {
    eyeMeshes = fuzzyEyeFind(scene);
    eyeSearchDone = true;
    console.log("👀 Eyes:", eyeMeshes.map(m => m.name));
  }
}

// ----------------- eye glow by emotion -----------------
function setEmotionEyesFromText(text) {
  ensureBindings();
  if (!eyeMeshes.length) return;

  const t = (text || "").toLowerCase();
  let color = { r: 0.2, g: 0.9, b: 0.2 }; // friendly green
  let intensity = 0.6;

  if (/angry|mad|furious|rage|stomp|venge/.test(t)) { color = { r: 1.0, g: 0.2, b: 0.1 }; intensity = 1.2; }
  else if (/sleep|tired|yawn|rest/.test(t)) { color = { r: 1.0, g: 0.7, b: 0.2 }; intensity = 0.4; }
  else if (/mischief|prank|sneaky|trick/.test(t)) { color = { r: 0.95, g: 0.5, b: 1.0 }; intensity = 0.9; }
  else if (/sad|blue|lonely/.test(t)) { color = { r: 0.2, g: 0.5, b: 1.0 }; intensity = 0.5; }

  for (const m of eyeMeshes) {
    if (m.material) {
      if (m.material.emissive) {
        m.material.emissive.setRGB(color.r * intensity, color.g * intensity, color.b * intensity);
      }
      if (m.material.emissiveIntensity !== undefined) {
        m.material.emissiveIntensity = clamp(intensity, 0.2, 2.0);
      }
      if (m.material.color && !m.material.emissive) {
        m.material.color.setRGB(lerp(1, color.r, 0.4), lerp(1, color.g, 0.4), lerp(1, color.b, 0.4));
      }
    }
  }
}

// ----------------- micro-idle gestures -----------------
function startMicroIdle() {
  if (microIdleRAF) return;
  microIdleActive = true;
  let t0 = performance.now();
  let phase = Math.random() * Math.PI * 2;

  const tick = (t) => {
    if (!microIdleActive || state !== "idle") {
      microIdleRAF = requestAnimationFrame(tick);
      return;
    }
    const dt = (t - t0) / 1000;
    t0 = t;

    ensureBindings();
    const scene = getThreeScene(activeMV);
    if (scene) {
      const head = jawBone?.parent || null;
      const s = Math.sin((performance.now() / 1000) * 0.6 + phase) * 0.03;
      if (head && head.rotation) {
        head.rotation.y = lerp(head.rotation.y, s, 0.05);
        head.rotation.x = lerp(head.rotation.x, -s * 0.5, 0.05);
      }
      for (const b of fingerBones) {
        if (b.rotation) {
          const k = Math.sin((performance.now() / 1000) * 0.8 + phase) * 0.02;
          b.rotation.z = lerp(b.rotation.z, k, 0.08);
        }
      }
    }

    if (!microIdleTimer || performance.now() > microIdleTimer) {
      microIdleTimer = performance.now() + (10000 + Math.random() * 10000);
      if (state === "idle") setAnim(ANIM.IDLE_MAIN, { minHoldMs: 600, blendMs: 500 });
    }

    microIdleRAF = requestAnimationFrame(tick);
  };
  microIdleRAF = requestAnimationFrame(tick);
}
function stopMicroIdle() {
  microIdleActive = false;
  if (microIdleRAF) cancelAnimationFrame(microIdleRAF);
  microIdleRAF = 0;
}

// ----------------- amplitude driver (jaw + fingers) -----------------
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
    const jawSmooth = { v: 0 };
    const fingerSmooth = { v: 0 };

    const drive = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const amp = clamp(rms * 6, 0, 1);

      jawSmooth.v = jawSmooth.v * 0.7 + amp * 0.3;
      fingerSmooth.v = fingerSmooth.v * 0.8 + amp * 0.2;

      ensureBindings();

      if (jawBone && jawBone.rotation) {
        const open = jawSmooth.v * 0.45; // up to ~26°
        jawBone.rotation.x = -open;
      }
      for (const b of fingerBones) {
        if (b.rotation) {
          const bend = fingerSmooth.v * 0.25;
          b.rotation.x = (b.rotation.x || 0) - bend * 0.15;
          b.rotation.z = (b.rotation.z || 0) + bend * 0.05;
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

// ----------------- smooth transitions (sequential fade) -----------------
async function setAnim(name, { minHoldMs = 800, blendMs = 600 } = {}) {
  if (!inactiveMV || !activeMV) return;

  // fade OUT current
  activeMV.classList.remove("active"); // triggers CSS opacity:0
  await sleep(blendMs);

  // prepare next (still hidden)
  const url = await ensureGlbUrl(name);
  inactiveMV.setAttribute("src", url);
  await waitForModelLoaded(inactiveMV);
  try { inactiveMV.currentTime = 0; await inactiveMV.play(); } catch {}

  // fade IN new
  inactiveMV.classList.add("active");
  await sleep(blendMs);

  // swap refs
  [activeMV, inactiveMV] = [inactiveMV, activeMV];

  // new model => rebind bones/eyes later
  boneSearchDone = false;
  eyeSearchDone = false;

  if (minHoldMs > 0) await sleep(minHoldMs);
}

// ----------------- warmup + idle refresh -----------------
async function warmup() {
  const warm = new Set([ANIM.IDLE_MAIN, ANIM.SHRUG, ANIM.SLEEP, ...talkPool]);
  let delay = 100;
  for (const name of warm) {
    setTimeout(() => ensureGlbUrl(name).catch(() => {}), delay);
    delay += 100;
  }
}

let idleSwapTimer = null;
function scheduleIdleSwap() {
  clearTimeout(idleSwapTimer);
  idleSwapTimer = setTimeout(async () => {
    if (state === "idle") await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 1000, blendMs: 500 });
    scheduleIdleSwap();
  }, 12000 + Math.random() * 5000);
}

// ----------------- voice & talking (smart + synced + micLock + deep tone) -----------------
let abortSpeech = null;
async function speakAndAnimate(userText) {
  if (!userText) return;
// inside speakAndAnimate(), replace the TTS fetch + play logic with:

const maxRetries = 2;
let ttsResp, ttsBuffer;
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    ttsResp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText, voice: "copper" }),
      signal: ac.signal,
    });
    if (!ttsResp.ok) {
      const errtxt = await ttsResp.text();
      console.warn(`TTS attempt ${attempt} failed:`, ttsResp.status, errtxt);
      if (attempt === maxRetries) {
        throw new Error(`TTS failed: ${ttsResp.status}`);
      }
      // fallback: try alternate voice
      continue;
    }
    ttsBuffer = await ttsResp.arrayBuffer();
    break;
  } catch (err) {
    console.warn("TTS error:", err);
    if (attempt === maxRetries) {
      setStatus("⚠️ Couldn’t speak — error from server");
      state = "idle";
      startMicroIdle();
      return;
    }
  }
}

// Now use ttsBuffer (Blob etc) as before
const blob = new Blob([ttsBuffer], { type: "audio/mpeg" });
const url = URL.createObjectURL(blob);
const audio = new Audio(url);
audio.playbackRate = 0.9;
...

  try {
    state = "talking";
    stopMicroIdle();
    setStatus("💬 Thinking...");

    // 1) AI reply
    const chatResp = await fetch(`${WORKER_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userText }),
    });
    const data = await chatResp.json();
    const replyText = data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖 Bob says:", replyText);

    // mood eyes
    setEmotionEyesFromText(replyText);

    // 2) TTS (deep raspy)
    const ac = new AbortController();
    abortSpeech = () => ac.abort();

    const resp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText, voice: "copper" }),
      signal: ac.signal,
    });

    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength < 1000) {
      console.warn("⚠️ Worker returned short or invalid audio response.");
      setStatus("⚠️ Invalid audio response");
      state = "idle";
      startMicroIdle();
      return;
    }

    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = 0.9; // heavier drawl

    // 🔇 lock mic so Bob doesn't hear himself
    micLocked = true;
    if (window.recognition) { try { window.recognition.stop(); } catch {} }

    // start talk anim & amplitude exactly when audio plays
    let talkStarted = false;
    audio.addEventListener("play", async () => {
      if (talkStarted) return;
      talkStarted = true;

      await setAnim(pick(talkPool), { minHoldMs: 0, blendMs: 350 });

      // keep refreshing talk while audio is playing
      const loopTick = () => {
        if (state !== "talking" || audio.paused || audio.ended) return;
        setTimeout(() => {
          if (state === "talking" && !audio.ended) {
            setAnim(pick(talkPool), { minHoldMs: 0, blendMs: 300 });
            loopTick();
          }
        }, 2000 + Math.random() * 500);
      };
      loopTick();

      startAmplitudeDriveFor(audio);
    }, { once: true });

    // robust autoplay
    const tryPlay = async () => {
      try {
        const p = audio.play();
        if (p !== undefined) await p;
        return true;
      } catch {}
      try {
        const dummy = new Audio();
        dummy.muted = true;
        await dummy.play().catch(() => {});
        await new Promise((r) => setTimeout(r, 80));
        await audio.play();
        return true;
      } catch {}
      setStatus("👆 Click to hear Bob...");
      document.addEventListener("click", () => {
        audio.play().then(() => setStatus("💬 Playing response...")).catch(console.error);
      }, { once: true });
      return false;
    };
    await tryPlay();

    audio.onended = async () => {
      stopAmplitudeDrive();
      URL.revokeObjectURL(url);
      state = "idle";
      setStatus("👂 Listening...");
      await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 600, blendMs: 500 });

      // 🔊 unlock mic after playback
      micLocked = false;
      if (window.recognition) { try { window.recognition.start(); } catch {} }

      startMicroIdle();
    };
  } catch (err) {
    console.error("Speech error:", err);
    stopAmplitudeDrive();
    setStatus("⚠️ Speech error — see console");
    state = "idle";
    micLocked = false;
    startMicroIdle();
  }
}

// ----------------- inactivity → sleep -----------------
let lastActivity = Date.now();
function bumpActivity() { lastActivity = Date.now(); }
setInterval(async () => {
  const idleMs = Date.now() - lastActivity;
  if (state === "idle" && idleMs > 45000) {
    state = "sleeping";
    stopMicroIdle();
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
    startMicroIdle();
  }
}, { passive: true });

// ----------------- microphone -----------------
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition) {
  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = "en-US";
  window.recognition = rec;

  rec.onresult = async (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.trim();
    if (transcript.length > 0) {
      console.log("🎤 Heard:", transcript);
      await speakAndAnimate(transcript);
    }
  };
  rec.onerror = (e) => console.warn("Speech recognition error:", e.error);
  rec.onend = () => {
    if (!micLocked && state === "idle") rec.start(); // respect lock
  };

  window.addEventListener("click", () => {
    try {
      rec.start();
      setStatus("👂 Listening (mic on)...");
    } catch (err) { console.warn("Mic start error:", err); }
  }, { once: true });
} else {
  console.warn("SpeechRecognition not supported in this browser.");
}

// ----------------- boot -----------------
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
    startMicroIdle();

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

// debug handle
window.Bob = { setAnim, speak: speakAndAnimate, state: () => state };
