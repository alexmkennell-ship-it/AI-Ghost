// bob.js — stable version (dynamic GLB + working mic)

let bob = null;
let statusEl = null;
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
  AGREE: "Animation_Agree_Gesture_withSkin",
  FUN_1: "Animation_Indoor_Play_withSkin",
  FUN_2: "Animation_Mummy_Stagger_withSkin",
  FUN_3: "Animation_Running_withSkin",
};

const idlePool = [ANIM.IDLE_MAIN, ANIM.FUN_1, ANIM.FUN_2, ANIM.FUN_3];
const talkPool = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4, ANIM.AGREE];

let state = "idle";
let lastActivity = Date.now();
let sleepTimer = null;
let hasStarted = false;
let idleTimer = null;
let idleSwapInFlight = false;

const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function ensureDomRefs() {
  if (!bob) {
    bob = document.getElementById("bob");
  }

  if (!statusEl) {
    statusEl = document.getElementById("status");
  }
}

function setStatus(msg) {
  ensureDomRefs();
  if (statusEl) statusEl.textContent = msg;
}
function bumpActivity() { lastActivity = Date.now(); }

let currentAnim = null;

const glbCache = new Map();
const glbPreloaders = new Map();

async function ensureGlbUrl(name) {
  if (glbCache.has(name)) {
    return glbCache.get(name);
  }

  if (glbPreloaders.has(name)) {
    return glbPreloaders.get(name);
  }

  const loader = (async () => {
    const response = await fetch(`${MODEL_BASE}${name}.glb`);
    if (!response.ok) {
      throw new Error(`Failed to preload ${name}: ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    glbCache.set(name, objectUrl);
    return objectUrl;
  })();

  glbPreloaders.set(name, loader);

  try {
    const url = await loader;
    return url;
  } catch (err) {
    glbCache.delete(name);
    throw err;
  } finally {
    glbPreloaders.delete(name);
  }
}

function schedulePreload(name, delay = 0) {
  if (glbCache.has(name) || glbPreloaders.has(name)) return;

  const start = () => {
    ensureGlbUrl(name).catch((err) =>
      console.warn(`⚠️ Failed to preload ${name}.`, err)
    );
  };

  const trigger = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => start(), { timeout: 4000 });
    } else {
      start();
    }
  };

  if (delay > 0) {
    setTimeout(trigger, delay);
  } else {
    trigger();
  }
}

function warmupAnimations() {
  const essential = new Set([
    ANIM.IDLE_MAIN,
    ANIM.SHRUG,
    ANIM.SLEEP,
    ...idlePool,
    ...talkPool,
  ]);

  let delay = 350;
  essential.forEach((clip) => {
    schedulePreload(clip, delay);
    delay += 200;
  });
}

function pickDistinct(pool) {
  if (!currentAnim) return pick(pool);
  const options = pool.filter((name) => name !== currentAnim);
  return pick(options.length ? options : pool);
}

// Wait until <model-viewer> finishes loading the new GLB
function waitForModelLoad(timeout = 5000) {
  return new Promise((resolve) => {
    ensureDomRefs();
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
  ensureDomRefs();
  if (!bob) return;

  let nextSrc = glbCache.get(name) || null;
  if (!nextSrc) {
    try {
      nextSrc = await ensureGlbUrl(name);
    } catch (err) {
      console.warn(`⚠️ Falling back to direct load for ${name}.`, err);
      nextSrc = `${MODEL_BASE}${name}.glb`;
    }
  }

  const nextSrc = `${MODEL_BASE}${name}.glb`;
  const currentSrc = bob.getAttribute("src");
  const needsSrcSwap = currentSrc !== nextSrc;

  if (needsSrcSwap) {
    bob.setAttribute("src", nextSrc);
    console.log("🎞️ Animation:", name);
    await waitForModelLoad();

    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  } else {
    console.log("🎞️ Animation (restart):", name);
  }

  // Ensure the clip starts from the beginning and is actively playing.
  try {
    bob.currentTime = 0;
    bob.play();
  } catch (err) {
    console.warn("⚠️ Unable to force animation playback.", err);
  }

  currentAnim = name;

  if (holdMs > 0) await sleep(holdMs);
}

// Idle cycle
function scheduleIdleSwap() {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (state !== "idle" || idleSwapInFlight) return;
    const next = pickDistinct(idlePool);
    idleSwapInFlight = true;
    setAnim(next)
      .catch((err) => console.warn("⚠️ Idle swap failed.", err))
      .finally(() => {
        idleSwapInFlight = false;
      });
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

    let audibleStartTimer = null;

    const cleanupPlaybackStarters = () => {
      audio.removeEventListener("playing", onPlaybackStart);
      audio.removeEventListener("play", onPlaybackStart);
      audio.removeEventListener("timeupdate", onAudibleProgress);
      if (audibleStartTimer) {
        clearTimeout(audibleStartTimer);
        audibleStartTimer = null;
      }
    };

    const kickOffTalking = () => {
      cleanupPlaybackStarters();
    const onPlaybackStart = () => {
      audio.removeEventListener("playing", onPlaybackStart);
      audio.removeEventListener("play", onPlaybackStart);
      state = "talking";
      startTalkingLoop();
    };

    const onAudibleProgress = () => {
      if (audio.currentTime >= 0.12) {
        kickOffTalking();
      }
    };

    const onPlaybackStart = () => {
      if (audio.currentTime >= 0.12) {
        kickOffTalking();
      }
    };

    audio.addEventListener("playing", onPlaybackStart);
    audio.addEventListener("play", onPlaybackStart);
    audio.addEventListener("timeupdate", onAudibleProgress);

    audibleStartTimer = setTimeout(kickOffTalking, 900);

    audio.onended = async () => {
      cleanupPlaybackStarters();
    audio.addEventListener("playing", onPlaybackStart);
    audio.addEventListener("play", onPlaybackStart);

    audio.onended = async () => {
      await stopTalkingLoop();
      await setAnim(ANIM.IDLE_MAIN);
      state = "idle";
      URL.revokeObjectURL(url);
    };

    try {
      await audio.play();
    } catch (err) {
      console.warn("⚠️ Autoplay blocked, waiting for click.", err);
      setStatus("👆 Click anywhere to let Bob speak.");
      document.body.addEventListener("click", () => audio.play(), { once: true });
    }
  } catch (err) {
    console.error("💀 Error talking to Bob:", err);
    setStatus("💀 Bob’s connection got spooked.");
  }
}

// Talking animation loop
let talkLoopActive = false;
let talkLoopPromise = null;

async function runTalkingLoop() {
  while (talkLoopActive && state === "talking") {
    const next = pickDistinct(talkPool);
    await setAnim(next);

    if (!talkLoopActive || state !== "talking") break;
    await sleep(rand(1500, 2400));
    await sleep(rand(1200, 2000));
  }
}

function startTalkingLoop() {
  if (talkLoopActive) return talkLoopPromise;
  talkLoopActive = true;

  talkLoopPromise = (async () => {
    try {
      await runTalkingLoop();
    } finally {
      talkLoopActive = false;
    }
  })();

  return talkLoopPromise;
}

async function stopTalkingLoop() {
  if (!talkLoopActive && !talkLoopPromise) return;
  talkLoopActive = false;

  try {
    await talkLoopPromise;
  } catch (err) {
    console.warn("⚠️ Talking loop ended with an error.", err);
  } finally {
    talkLoopPromise = null;
  }
}

// Sleep mode
async function enterSleep() {
  if (state === "sleeping") return;
  state = "sleeping";
  setStatus("💤 Bob’s snoozin’...");
  await setAnim(ANIM.SLEEP);
}

// Start listening immediately after the user clicks
function startListening() {
  ensureDomRefs();
  if (!bob) {
    setStatus("❌ Bob is missing from the page.");
    return;
  }

  if (hasStarted) return;
  hasStarted = true;

  console.log("🎧 Bob is ready to listen!");
  state = "idle";
  bumpActivity();
  setStatus("👂 Listening...");
  schedulePreload(ANIM.SHRUG);
  warmupAnimations();
  setAnim(ANIM.IDLE_MAIN).catch((err) =>
    console.warn("⚠️ Failed to start idle animation immediately.", err)
  );
  scheduleIdleSwap();
  startVoiceRecognition();
}

// Boot sequence
window.addEventListener("DOMContentLoaded", () => {
  ensureDomRefs();
  if (!bob) {
    console.warn("⚠️ Bob element missing in DOM — status frozen.");
    setStatus("❌ Bob failed to appear on the page.");
    return;
  }

  const overlay = document.getElementById("wakeOverlay");

  const unlockAudio = async () => {
    try {
      await new Audio().play().catch(() => {});
    } catch (err) {
      console.warn("⚠️ Unable to unlock audio on activation.", err);
    }
  };

  const activate = async () => {
    if (hasStarted) return;
    console.log("🖱️ Activation click detected");
    await unlockAudio();
    startListening();
  };

  const handleWakeClick = async (event) => {
    event?.stopPropagation?.();
    console.log("🖱️ Wake click detected");
    overlay?.remove();
    await activate();
  };

  if (overlay) {
    overlay.addEventListener("click", handleWakeClick, { once: true });
    setStatus("👆 Click to chat with Bob.");
  } else {
    setStatus("👆 Click anywhere to start.");
  }

  bob.addEventListener("load", () => {
    console.log("✅ Bob ready!");
    if (!overlay && !hasStarted) {
      activate();
    }
  });

  document.addEventListener("click", activate, { once: true });

  document.addEventListener("click", bumpActivity, { passive: true });
  document.addEventListener("keydown", bumpActivity, { passive: true });
});

window.addEventListener("beforeunload", () => {
  glbCache.forEach((url) => URL.revokeObjectURL(url));
  glbCache.clear();
});
