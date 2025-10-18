/*
 * Bob.js (idle rig version)
 *
 * This script loads a 3D rig and animation from your Cloudflare R2 bucket.
 * To avoid issues with a missing or empty T‑pose file, the base rig is now
 * set to the same FBX file used for the “Neutral Idle” animation. File names
 * are URL‑encoded with encodeURIComponent to handle spaces. A visible
 * wireframe material and skeleton helper are applied for debugging so you
 * can verify that geometry is present. If the rig fails to load, the
 * script falls back to the Samba dancer from the Three.js examples.
 */

console.log("🟢 Booting Bob (idle rig)…");

// Base URL pointing at your public R2 bucket. Ensure CORS is enabled.
const WORKER_URL = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev";
const FBX_BASE   = `${WORKER_URL}/models/`;

// Use the idle FBX as the base rig. Names are case‑sensitive.
const BASE_RIG   = "Neutral Idle.fbx";
// Play the idle animation on load; omit or set to null to skip.
const START_ANIM = "Neutral Idle";

// Fallback rig from the Three.js examples (always public)
const FALLBACK_RIG_URL = "https://threejs.org/examples/models/fbx/Samba%20Dancing.fbx";

let scene, camera, renderer, mixer, rigRoot;
const clock = new THREE.Clock();

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

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);
  camera.lookAt(new THREE.Vector3(0, 1, 0));

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

function addSkeletonHelper(rig) {
  const helper = new THREE.SkeletonHelper(rig);
  helper.material.linewidth = 2;
  helper.material.color.set(0xff00ff);
  scene.add(helper);
}

async function loadRig(useFallback = false) {
  const loader = new FBXLoader();
  loader.setCrossOrigin("anonymous");
  const url = useFallback ? FALLBACK_RIG_URL : FBX_BASE + encodeURIComponent(BASE_RIG);
  try {
    const rig = await loader.loadAsync(url);
    console.log("✅ Rig loaded from", url);
    rig.scale.setScalar(useFallback ? 0.02 : 0.02);
    rig.position.set(0, -1, 0);
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

async function loadAnim(name) {
  const loader = new FBXLoader();
  loader.setCrossOrigin("anonymous");
  const url = FBX_BASE + encodeURIComponent(name) + ".fbx";
  const fbx = await loader.loadAsync(url);
  console.log("🎬 Animation loaded:", url);
  return fbx.animations[0];
}

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

function animate() {
  requestAnimationFrame(animate);
  if (mixer) {
    mixer.update(clock.getDelta());
  }
  renderer.render(scene, camera);
}

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
