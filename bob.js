// bob.js — Expressive Build 3.1 “Cinematic Focus”
// • 5.8 m default camera, 7.2 m sleep dolly, never closer than 5.8 m
// • Focus recenter: tracks head every 1 s to keep framing perfect
// • All features from 2.9 (Living Bob): skits, cache, mic-lock, etc.

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

//////////////////////////////////////////////////////////////////
// KEEP ALL PREVIOUS ANIM DEFINITIONS AND SUPPORT FUNCTIONS HERE //
//////////////////////////////////////////////////////////////////

// ---------- Camera (5.8 m base + focus tracking) ----------
let activeMV, camDriftRAF = 0, camDriftActive = false, camYawBase = 0;
let focusRAF = 0, focusActive = false, focusBone = null;

function setCameraOrbitImmediate(orbitStr) {
  if (!activeMV) return;
  activeMV.setAttribute("camera-orbit", orbitStr);
  rememberOrbit(orbitStr);
  const parts = orbitStr.split(" ");
  camYawBase = parseFloat(parts[0]) || 0;
}

// Smooth dolly-only zoom
async function smoothCameraTransition(targetRadius, duration = 1000) {
  const mv = activeMV;
  if (!mv) return;
  const orbit = mv.getAttribute("camera-orbit") || recallOrbit();
  const parts = orbit.split(" ");
  const currentRadius = parseFloat(parts[2]) || 5.8;
  const start = clamp(currentRadius, 5.8, 8.0);
  const end = clamp(targetRadius, 5.8, 8.0);
  const startTime = performance.now();
  const step = (t) => {
    const k = Math.min((t - startTime) / duration, 1);
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * k);
    const r = lerp(start, end, eased);
    const out = `${camYawBase.toFixed(2)}deg 75deg ${r.toFixed(2)}m`;
    mv.setAttribute("camera-orbit", out);
    rememberOrbit(out);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Subtle yaw drift during idle
function startCamDrift() {
  if (camDriftRAF) return;
  camDriftActive = true;
  const base = camYawBase;
  const startT = performance.now();
  const tick = (t) => {
    if (!camDriftActive || state !== "idle") {
      camDriftRAF = requestAnimationFrame(tick);
      return;
    }
    const elapsed = (t - startT) / 1000;
    const yaw = base + Math.sin(elapsed * 0.15) * 5;
    const orbit =
      activeMV?.getAttribute("camera-orbit") || "0deg 75deg 5.8m";
    const parts = orbit.split(" ");
    const radius = parts[2] || "5.8m";
    const out = `${yaw.toFixed(2)}deg 75deg ${radius}`;
    activeMV?.setAttribute("camera-orbit", out);
    rememberOrbit(out);
    camDriftRAF = requestAnimationFrame(tick);
  };
  camDriftRAF = requestAnimationFrame(tick);
}
function stopCamDrift() {
  camDriftActive = false;
  if (camDriftRAF) cancelAnimationFrame(camDriftRAF);
  camDriftRAF = 0;
}

// ---------- Auto-focus recenter ----------
function startFocusTracking() {
  if (focusRAF) return;
  focusActive = true;
  const tick = () => {
    if (!focusActive || !activeMV?.model?.scene) {
      focusRAF = requestAnimationFrame(tick);
      return;
    }
    try {
      if (!focusBone) {
        activeMV.model.scene.traverse((o) => {
          if (/head|neck|spine2/i.test(o.name)) focusBone = o;
        });
      }
      if (focusBone?.getWorldPosition) {
        const pos = focusBone.getWorldPosition(new THREE.Vector3());
        activeMV.setAttribute(
          "camera-target",
          `${pos.x.toFixed(2)}m ${pos.y.toFixed(2)}m ${pos.z.toFixed(2)}m`
        );
      }
    } catch {}
    focusRAF = requestAnimationFrame(tick);
  };
  focusRAF = requestAnimationFrame(tick);
}
function stopFocusTracking() {
  focusActive = false;
  if (focusRAF) cancelAnimationFrame(focusRAF);
  focusRAF = 0;
}

// ---------- Sleep / Wake (using new dolly limits) ----------
async function enterSleep() {
  if (state !== "idle" || sleepLock) return;
  sleepLock = true;
  state = "sleeping";
  stopMicroIdle();
  stopCamDrift();
  setStatus("😴 Nodding off…");
  await smoothCameraTransition(7.2, 1200); // farther back
  await setAnim(ANIM.SLEEP, { minHoldMs: 1800, blendMs: 600 });
}
async function standUpSequence() {
  await smoothCameraTransition(5.8, 1000); // return to base
  await setAnim(ANIM.WAKE_UP, { minHoldMs: 400, blendMs: 700 });
  await setAnim(ANIM.STAND_UP, { minHoldMs: 500, blendMs: 600 });
  await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800, blendMs: 500 });
  startMicroIdle();
  startCamDrift();
  startFocusTracking();
  state = "idle";
  sleepLock = false;
  setStatus("👂 Listening...");
  saySkitFor(ANIM.WAKE_UP);
}

// ---------- Boot ----------
async function boot() {
  try {
    console.log("🟢 Booting Bob...");
    statusEl = document.getElementById("status");
    mvA = document.getElementById("mvA");
    mvB = document.getElementById("mvB");
    if (!mvA || !mvB) {
      setStatus("Error: model-viewer not found");
      return;
    }
    activeMV = mvA;
    inactiveMV = mvB;
    activeMV.classList.add("active");

    // Cinematic default
    setCameraOrbitImmediate("0deg 75deg 5.8m");
    activeMV.setAttribute("camera-target", "0m 1.2m 0m");

    setStatus("Warming up…");
    await warmup();
    console.log("✅ Warmup complete");

    await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800, blendMs: 300 });
    state = "idle";
    lastActivity = now();
    startMicroIdle();
    startCamDrift();
    startFocusTracking();

    const orbit =
      activeMV.getAttribute("camera-orbit") || "0deg 75deg 5.8m";
    const parts = orbit.split(" ");
    const r = parseFloat(parts[2]) || 5.8;
    if (r < 5.8) setCameraOrbitImmediate("0deg 75deg 5.8m");

    scheduleIdleVariety();
    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "p") {
        speakAndAnimate(
          "Howdy partner! Ready to rustle up some mischief?"
        );
      }
    });
    console.log("🎉 Bob ready!");
  } catch (e) {
    console.error("Boot error:", e);
    setStatus("⚠️ Failed to load Bob");
  }
}
window.addEventListener("DOMContentLoaded", () => {
  console.log("📦 DOMContentLoaded — launching boot()");
  boot();
});
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * k);
    const r = lerp(start, end, eased);
    const out = `${camYawBase.toFixed(2)}deg 75deg ${r.toFixed(2)}m`;
    mv.setAttribute("camera-orbit", out);
    rememberOrbit(out);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Subtle yaw drift during idle
function startCamDrift() {
  if (camDriftRAF) return;
  camDriftActive = true;
  const base = camYawBase;
  const startT = performance.now();
  const tick = (t) => {
    if (!camDriftActive || state !== "idle") {
      camDriftRAF = requestAnimationFrame(tick);
      return;
    }
    const elapsed = (t - startT) / 1000;
    const yaw = base + Math.sin(elapsed * 0.15) * 5;
    const orbit =
      activeMV?.getAttribute("camera-orbit") || "0deg 75deg 5.8m";
    const parts = orbit.split(" ");
    const radius = parts[2] || "5.8m";
    const out = `${yaw.toFixed(2)}deg 75deg ${radius}`;
    activeMV?.setAttribute("camera-orbit", out);
    rememberOrbit(out);
    camDriftRAF = requestAnimationFrame(tick);
  };
  camDriftRAF = requestAnimationFrame(tick);
}
function stopCamDrift() {
  camDriftActive = false;
  if (camDriftRAF) cancelAnimationFrame(camDriftRAF);
  camDriftRAF = 0;
}

// ---------- Auto-focus recenter ----------
function startFocusTracking() {
  if (focusRAF) return;
  focusActive = true;
  const tick = () => {
    if (!focusActive || !activeMV?.model?.scene) {
      focusRAF = requestAnimationFrame(tick);
      return;
    }
    try {
      if (!focusBone) {
        activeMV.model.scene.traverse((o) => {
          if (/head|neck|spine2/i.test(o.name)) focusBone = o;
        });
      }
      if (focusBone?.getWorldPosition) {
        const pos = focusBone.getWorldPosition(new THREE.Vector3());
        activeMV.setAttribute(
          "camera-target",
          `${pos.x.toFixed(2)}m ${pos.y.toFixed(2)}m ${pos.z.toFixed(2)}m`
        );
      }
    } catch {}
    focusRAF = requestAnimationFrame(tick);
  };
  focusRAF = requestAnimationFrame(tick);
}
function stopFocusTracking() {
  focusActive = false;
  if (focusRAF) cancelAnimationFrame(focusRAF);
  focusRAF = 0;
}

// ---------- Sleep / Wake (using new dolly limits) ----------
async function enterSleep() {
  if (state !== "idle" || sleepLock) return;
  sleepLock = true;
  state = "sleeping";
  stopMicroIdle();
  stopCamDrift();
  setStatus("😴 Nodding off…");
  await smoothCameraTransition(7.2, 1200); // farther back
  await setAnim(ANIM.SLEEP, { minHoldMs: 1800, blendMs: 600 });
}
async function standUpSequence() {
  await smoothCameraTransition(5.8, 1000); // return to base
  await setAnim(ANIM.WAKE_UP, { minHoldMs: 400, blendMs: 700 });
  await setAnim(ANIM.STAND_UP, { minHoldMs: 500, blendMs: 600 });
  await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800, blendMs: 500 });
  startMicroIdle();
  startCamDrift();
  startFocusTracking();
  state = "idle";
  sleepLock = false;
  setStatus("👂 Listening...");
  saySkitFor(ANIM.WAKE_UP);
}

// ---------- Boot ----------
async function boot() {
  try {
    console.log("🟢 Booting Bob...");
    statusEl = document.getElementById("status");
    mvA = document.getElementById("mvA");
    mvB = document.getElementById("mvB");
    if (!mvA || !mvB) {
      setStatus("Error: model-viewer not found");
      return;
    }
    activeMV = mvA;
    inactiveMV = mvB;
    activeMV.classList.add("active");

    // Cinematic default
    setCameraOrbitImmediate("0deg 75deg 5.8m");
    activeMV.setAttribute("camera-target", "0m 1.2m 0m");

    setStatus("Warming up…");
    await warmup();
    console.log("✅ Warmup complete");

    await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800, blendMs: 300 });
    state = "idle";
    lastActivity = now();
    startMicroIdle();
    startCamDrift();
    startFocusTracking();

    const orbit =
      activeMV.getAttribute("camera-orbit") || "0deg 75deg 5.8m";
    const parts = orbit.split(" ");
    const r = parseFloat(parts[2]) || 5.8;
    if (r < 5.8) setCameraOrbitImmediate("0deg 75deg 5.8m");

    scheduleIdleVariety();
    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "p") {
        speakAndAnimate(
          "Howdy partner! Ready to rustle up some mischief?"
        );
      }
    });
    console.log("🎉 Bob ready!");
  } catch (e) {
    console.error("Boot error:", e);
    setStatus("⚠️ Failed to load Bob");
  }
}
window.addEventListener("DOMContentLoaded", () => {
  console.log("📦 DOMContentLoaded — launching boot()");
  boot();
});
