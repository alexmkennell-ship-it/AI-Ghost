console.log("🟢 Booting Bob (v6.3-fix — tolerant)…");

const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const BASE_RIG = "T-Pose.fbx";
const START_ANIM = "Neutral Idle";

// ---------- WAIT FOR GLOBALS ----------
function waitForThree() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (window.THREE && (window.FBXLoader || (window.THREE.FBXLoader))) {
        if (!window.FBXLoader && window.THREE.FBXLoader)
          window.FBXLoader = window.THREE.FBXLoader;
        resolve();
      } else if (tries++ < 60) {
        setTimeout(check, 250); // wait up to ~15s total
      } else {
        reject(new Error("THREE.js or FBXLoader still not found after waiting."));
      }
    };
    check();
  });
}

// ---------- GLOBALS ----------
let scene, camera, renderer, mixer, rigRoot;
const clock = new THREE.Clock ? new THREE.Clock() : null;

// ---------- CORE ----------
async function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.5, 5);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.8);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(4, 6, 3);
  scene.add(hemi, dir);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5, 64),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);
}

function buildDebugBob(rig) {
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.6, 1.8, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x00ff88 })
  );
  rig.add(body);
  console.log("✅ Added bright green debug body to rig.");
}

async function loadRig() {
  const loader = new FBXLoader();
  const rig = await loader.loadAsync(FBX_BASE + BASE_RIG);
  console.log("✅ Rig loaded:", rig);
  rig.scale.setScalar(1);
  rig.position.set(0, 0, 0);
  scene.add(rig);
  rigRoot = rig;
  buildDebugBob(rigRoot);

  const box = new THREE.Box3().setFromObject(rigRoot);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(0, size * 0.2, size * 1.5)));
  camera.lookAt(center);

  mixer = new THREE.AnimationMixer(rigRoot);
}

async function loadAnim(name) {
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + name + ".fbx");
  console.log("🎬 Animation loaded:", name);
  return fbx.animations[0];
}

async function play(name) {
  const clip = await loadAnim(name);
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();
}

function animate() {
  requestAnimationFrame(animate);
  mixer?.update(clock?.getDelta() ?? 0.016);
  renderer.render(scene, camera);
}

// ---------- BOOT ----------
(async () => {
  document.getElementById("status").textContent = "Loading Bob...";
  try {
    await waitForThree();
    console.log("✅ THREE + FBXLoader ready.");
    await initThree();
    await loadRig();
    await play(START_ANIM);
    document.getElementById("status").textContent = "👂 Listening...";
    animate();
  } catch (err) {
    console.error("❌ Boot error:", err);
    document.getElementById("status").textContent = "❌ Load error.";
  }
})();
