console.log("🤠 Booting Bob (v6.9 — He’s Right There, Partner)…");

// ✅ Correct Worker and model path
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = WORKER_URL + "/bob-animations/models/";
const BASE_RIG   = "T-Pose.fbx";      // confirm case-sensitive name in R2
const START_ANIM = "Neutral Idle";

let scene, camera, renderer, mixer, rigRoot, clock;
let state = "idle";

// -------- Wait for THREE + FBXLoader --------
async function waitForGlobals() {
  let tries = 0;
  while (tries++ < 100) {
    if (window.THREE && (window.FBXLoader || (window.THREE && THREE.FBXLoader))) {
      if (!window.FBXLoader && window.THREE.FBXLoader)
        window.FBXLoader = window.THREE.FBXLoader;
      console.log("✅ THREE + FBXLoader ready.");
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("❌ FBXLoader never became available.");
}

// -------- Scene Setup --------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(3, 6, 3);
  const amb = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(hemi, dir, amb);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5, 64),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);

  clock = new THREE.Clock();
}

// -------- Load Rig from Worker --------
async function loadRig() {
  const loader = new FBXLoader();
  const rigURL = FBX_BASE + BASE_RIG;
  console.log("🪶 Loading rig from:", rigURL);

  try {
    const rig = await loader.loadAsync(rigURL);
    console.log("✅ Rig loaded successfully:", rig);

    rig.scale.setScalar(0.01);
    rig.position.y = -1;
    scene.add(rig);
    rigRoot = rig;

    // 👀 Ensure he’s visible — green emissive + bounding box
    rig.traverse(o => {
      if (o.isMesh) {
        o.material.emissive = new THREE.Color(0x00ff00);
        o.material.emissiveIntensity = 0.25;
      }
    });

    const box = new THREE.Box3().setFromObject(rig);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const helper = new THREE.Box3Helper(box, 0x00ff00);
    scene.add(helper);

    camera.position.copy(center.clone().add(new THREE.Vector3(0, size * 0.1, size * 1.3)));
    camera.lookAt(center);

    mixer = new THREE.AnimationMixer(rig);
  } catch (err) {
    console.error("❌ Failed to load FBX:", err);
  }
}

// -------- Load and Play Animation --------
async function loadAnim(name) {
  const loader = new FBXLoader();
  const fbxURL = FBX_BASE + name + ".fbx";
  console.log("🎞️ Loading animation:", fbxURL);
  const fbx = await loader.loadAsync(fbxURL);
  return fbx.animations[0];
}

async function play(name) {
  try {
    const clip = await loadAnim(name);
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    return action;
  } catch (err) {
    console.warn("⚠️ Could not load animation:", name, err);
  }
}

// -------- Animate Loop --------
function animate() {
  requestAnimationFrame(animate);
  mixer?.update(clock.getDelta());
  renderer.render(scene, camera);
}

// -------- Boot --------
(async () => {
  document.getElementById("status").textContent = "Loading Bob...";
  await waitForGlobals();
  initThree();
  await loadRig();
  await play(START_ANIM);
  document.getElementById("status").textContent = "👂 Listening...";
  animate();
})();