/*
 * Bob.js (custom drop‑in)
 *
 * This script loads a 3D cowboy rig and its animations from your
 * Cloudflare R2 bucket, applies a fallback if the rig fails, and
 * ensures all meshes have a visible material. It also adds a
 * skeleton helper for debugging so you can see the bone hierarchy.
 */

console.log("🟢 Booting Bob (custom build)…");

// Base URL pointing at your public R2 bucket. Ensure CORS is enabled.
const WORKER_URL = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev";
const FBX_BASE   = `${WORKER_URL}/models/`;

// Filenames (case‑sensitive!)
const BASE_RIG   = "T-Pose.fbx";     // your rig file
const START_ANIM = "Neutral Idle";   // animation file (without .fbx extension)

// Fallback rig from the Three.js examples (always public)
const FALLBACK_RIG_URL = "https://threejs.org/examples/models/fbx/Samba%20Dancing.fbx";
const FALLBACK_REASON  = "Bob's rig failed to load. Displaying the Samba fallback.";

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
  // Use sRGB encoding for colour‑correct rendering (r146 syntax).
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 5);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  const dir  = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 6, 3);
  const amb  = new THREE.AmbientLight(0xffffff, 0.3);
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
 * Traverse a rig and apply a basic material to all meshes.
 * This avoids invisible meshes if texture references are broken.
 */
function applyBasicMaterial(rig) {
  rig.traverse(obj => {
    if (obj.isMesh) {
      obj.material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 1,
        skinning: !!obj.isSkinnedMesh
      });
      obj.material.side = THREE.DoubleSide;
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
 * Load the rig, position it, apply materials, and set up the camera.
 * If `useFallback` is true, loads the Samba model instead.
 */
async function loadRig(useFallback = false) {
  const loader = new FBXLoader();
  loader.setCrossOrigin("anonymous");
  const url = useFallback ? FALLBACK_RIG_URL : FBX_BASE + BASE_RIG;
  try {
    const rig = await loader.loadAsync(url);
    console.log("✅ Rig loaded from", url);
    rig.scale.setScalar(useFallback ? 0.02 : 0.01); // adjust scaling
    rig.position.set(0, 0, 0);
    scene.add(rig);
    rigRoot = rig;
    applyBasicMaterial(rigRoot);
    addSkeletonHelper(rigRoot);

    // Frame the rig in view
    const box    = new THREE.Box3().setFromObject(rigRoot);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3()).length();
    camera.position.copy(center.clone().add(new THREE.Vector3(0, size * 0.2, size * 1.5)));
    camera.lookAt(center);

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
    await play(START_ANIM);
    if (statusEl) statusEl.textContent = "👂 Listening…";
    animate();
  } catch (err) {
    console.error("❌ Boot error:", err);
    if (statusEl) statusEl.textContent = "❌ Load error.";
  }
})();