/*
 * Bob.js (debug version)
 *
 * This script loads a 3D cowboy rig and its animations from your
 * Cloudflare R2 bucket, applies a fallback if the rig fails, and
 * forces all meshes to render as bright yellow wireframes so you can
 * verify the geometry. It uses a fixed camera position.
 */

console.log("🟢 Booting Bob (debug build)…");

// Base URL pointing at your public R2 bucket. Ensure CORS is enabled.
const WORKER_URL = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev";
const FBX_BASE   = `${WORKER_URL}/models/`;

// Filenames (case‑sensitive!)
const BASE_RIG   = "T-Pose.fbx";
const START_ANIM = "Neutral Idle";

// Fallback rig from the Three.js examples (always public)
const FALLBACK_RIG_URL = "https://threejs.org/examples/models/fbx/Samba%20Dancing.fbx";

let scene, camera, renderer, mixer, rigRoot;
const clock = new THREE.Clock();

/**
 * Wait until THREE and FBXLoader are available on the global object.
 * Resolves when ready or rejects after ~15 seconds.
 */
function waitForThree() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (window.THREE && (window.FBXLoader || (window.THREE.FBXLoader))) {
        if (!window.FBXLoader && window.THREE.FBXLoader) {
          window.FBXLoader = window.THREE.FBXLoader;
        }
        resolve();
      } else if (tries++ < 60) {
        setTimeout(check, 250);
      } else {
        reject(new Error("THREE.js or FBXLoader still not found after waiting."));
      }
    };
    check();
  });
}

/**
 * Initialise Three.js renderer, camera and scene with basic lighting and ground.
 */
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);
  camera.lookAt(new THREE.Vector3(0, 1, 0));

  const hemi  = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  const dir   = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 6, 3);
  const amb   = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(hemi, dir, amb);

  // Optional ground plane; comment out to remove the grey bar.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5, 64),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);
}

/**
 * Traverse a rig and apply a visible material to all meshes.
 * Using bright yellow wireframe to verify geometry.
 */
function applyDebugMaterial(rig) {
  rig.traverse(obj => {
    if (obj.isMesh) {
      obj.material = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        wireframe: true
      });
      obj.visible = true;
    }
  });
}

/**
 * Add a skeleton helper to visualise bones for debugging.
 */
function addSkeletonHelper(rig) {
  const helper = new THREE.SkeletonHelper(rig);
  helper.material.linewidth = 2;
  helper.material.color.set(0xff00ff);
  scene.add(helper);
}

/**
 * Load the rig, scale and position it, and add debug helpers.
 * If `useFallback` is true, loads the Samba model instead.
 */
async function loadRig(useFallback = false) {
  const loader = new FBXLoader();
  loader.setCrossOrigin("anonymous");
  const url = useFallback ? FALLBACK_RIG_URL : FBX_BASE + BASE_RIG;
  try {
    const rig = await loader.loadAsync(url);
    console.log("✅ Rig loaded from", url);
    rig.scale.setScalar(useFallback ? 0.02 : 0.02); // tweak if needed
    rig.position.set(0, -1, 0);                      // drop onto the ground plane
    scene.add(rig);
    rigRoot = rig;
    applyDebugMaterial(rigRoot);
    addSkeletonHelper(rigRoot);
    mixer = new THREE.AnimationMixer(rigRoot);
  } catch (err) {
    console.error("❌ Failed to load rig:", err);
    if (!useFallback) {
      const statusEl = document.getElementById("status");
      if (statusEl) statusEl.textContent = "Rig failed, loading fallback…";
      return loadRig(true);
    }
    throw err;
  }
}

/**
 * Load an animation file from the base URL.
 */
async function loadAnim(name) {
  const loader = new FBXLoader();
  loader.setCrossOrigin("anonymous");
  const url = FBX_BASE + name + ".fbx";
  const fbx = await loader.loadAsync(url);
  console.log("🎬 Animation loaded:", url);
  return fbx.animations[0];
}

/**
 * Play a named animation on the current rig. If loading fails, logs a warning.
 */
async function play(name) {
  try {
    const clip = await loadAnim(name);
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  } catch (err) {
    console.warn("⚠️ Could not load animation:", name, err);
  }
}

/**
 * Animation loop. Updates the mixer and renders the scene.
 */
function animate() {
  requestAnimationFrame(animate);
  mixer?.update(clock.getDelta());
  renderer.render(scene, camera);
}

// Boot sequence
(async () => {
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "Loading Bob…";
  try {
    await waitForThree();
    console.log("✅ THREE + FBXLoader ready.");
    initThree();
    await loadRig();
    if (START_ANIM) {
      await play(START_ANIM);
    }
    if (statusEl) statusEl.textContent = "👂 Listening…";
    animate();
  } catch (err) {
    console.error("❌ Boot error:", err);
    if (statusEl) statusEl.textContent = "❌ Load error.";
  }
})();
