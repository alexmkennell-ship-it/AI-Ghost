console.log("🟢 Booting Bob (v6.1 — Real Bob)…");

// ---------- CONFIG ----------
// Not using the worker URL for now, but kept for future enhancements.
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
// Base path pointing to your public R2 bucket; ensure CORS is enabled.
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// ---------- VERIFY GLOBALS ----------
// Ensure FBXLoader is globally available. If the loader is attached to
// THREE, copy it to the global namespace for compatibility.
if (typeof window.FBXLoader === "undefined" && window.THREE && THREE.FBXLoader) {
  window.FBXLoader = THREE.FBXLoader;
  console.log("🧩 FBXLoader patched to global scope.");
}
if (typeof THREE === "undefined" || typeof FBXLoader === "undefined") {
  throw new Error("❌ THREE.js or FBXLoader missing.");
}

// ---------- UTILS ----------
const setStatus = (m) => {
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = m;
};
const cache = {};

// ---------- GLOBALS ----------
let scene, camera, renderer, clock, mixer, model, currentAction;
let state = "boot";
// Camera parameters for orbit motion
const cam = {
  radius: 3.5,
  yaw: 0,
  pitch: 0.4,
  drift: false,
  target: new THREE.Vector3(0, 1, 0)
};

// ---------- INIT ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // Prefer the new outputColorSpace property when available (r152+); fall back to outputEncoding for older builds.
  if (renderer.outputColorSpace !== undefined) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);

  // Soft three-point lighting to give Bob some depth. Adjust intensity as desired.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.45);
  const key  = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(2, 4, 3);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-2, 2, -2);
  const rim  = new THREE.DirectionalLight(0xffffff, 0.3);
  rim.position.set(0, 3, -3);
  scene.add(hemi, key, fill, rim);

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // OrbitControls let you manually rotate around Bob. You can remove if not needed.
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.copy(cam.target);
  controls.update();
}

// ---------- MODEL LOAD ----------
async function loadModel() {
  const loader = new FBXLoader();
  // Load the rig file. Use encodeURIComponent in case the filename contains spaces.
  const rigUrl = FBX_BASE + encodeURIComponent("T-Pose.fbx");
  const fbx    = await loader.loadAsync(rigUrl);
  fbx.scale.setScalar(0.01);
  fbx.position.set(0, 0, 0);
  scene.add(fbx);
  model = fbx;

  // Apply a simple bone-like material instead of a camo texture. Adjust the color to your liking.
  model.traverse(o => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({
        color: 0xE0D8CA,       // light bone color
        metalness: 0.0,
        roughness: 1.0,
        side: THREE.DoubleSide
      });
      o.material.needsUpdate = true;
    }
  });

  mixer = new THREE.AnimationMixer(model);

  // Fit the camera around the model using its bounding box
  const box    = new THREE.Box3().setFromObject(model);
  const size   = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size / 1.5, size / 2.5, size / 1.5)));
  camera.lookAt(center);
  return model;
}

// ---------- ANIMATION ----------
async function loadClip(name) {
  if (cache[name]) return cache[name];
  const loader = new FBXLoader();
  const animUrl = FBX_BASE + encodeURIComponent(name) + ".fbx";
  const fbx     = await loader.loadAsync(animUrl);
  const clip    = fbx.animations[0];
  cache[name]   = clip;
  return clip;
}

async function play(name) {
  if (!mixer) return;
  const clip = await loadClip(name);
  if (!clip) return;
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  if (currentAction) currentAction.crossFadeTo(action, 0.4, false);
  action.play();
  currentAction = action;
}

// ---------- CAMERA + LOOP ----------
function updateCamera() {
  const r  = cam.radius;
  const y  = cam.pitch;
  const xz = r * Math.cos(y);
  camera.position.set(
    cam.target.x + xz * Math.sin(cam.yaw),
    cam.target.y + r * Math.sin(y),
    cam.target.z + xz * Math.cos(cam.yaw)
  );
  camera.lookAt(cam.target);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  updateCamera();
  renderer.render(scene, camera);
}

// ---------- AUDIO CLICK UNLOCK ----------
document.body.addEventListener(
  "click",
  () => {
    if (state === "boot") {
      state = "idle";
      setStatus("👂 Listening...");
    }
  },
  { once: true }
);

// ---------- BOOT ----------
async function boot() {
  setStatus("Initializing Bob...");
  initThree();
  try {
    await loadModel();
    // Play the neutral idle animation by default. Change the name to another
    // animation file in your bucket if desired.
    await play("Neutral Idle");
  } catch (err) {
    console.error(err);
    setStatus("⚠️ Failed to load FBX or animation.");
    return;
  }
  animate();
  state = "idle";
  setStatus("👂 Listening...");
}
boot().catch(e => {
  console.error(e);
  setStatus("❌ Load error.");
});
