console.log("🤠 Booting Bob (v6.9+)…");

// Base URL for your R2 bucket (public and CORS‑enabled)
const WORKER_URL = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev";
const FBX_BASE   = WORKER_URL + "/models/";
const BASE_RIG   = "T-Pose.fbx";
const START_ANIM = "Neutral Idle";

// Fallback asset from Three.js demos
const FALLBACK_RIG_URL = "https://threejs.org/examples/models/fbx/Samba%20Dancing.fbx";
const FALLBACK_REASON  = "Bob's CDN returned an error (likely 403 Forbidden). Showing fallback rig.";

let scene, camera, renderer, mixer, rigRoot, clock;
let usingFallbackRig = false;
let fallbackClip = null;

async function waitForGlobals() {
  let tries = 0;
  while (tries++ < 100) {
    if (window.THREE && (window.FBXLoader || (window.THREE && THREE.FBXLoader))) {
      if (!window.FBXLoader && window.THREE.FBXLoader)
        window.FBXLoader = window.THREE.FBXLoader;
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("❌ FBXLoader never became available.");
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // Use sRGBEncoding for r146; newer versions use outputColorSpace.
  renderer.outputEncoding = THREE.sRGBEncoding;
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

async function loadRig(useFallback = false) {
  const loader = new FBXLoader();
  loader.setCrossOrigin("anonymous");
  const rigURL = useFallback ? FALLBACK_RIG_URL : FBX_BASE + BASE_RIG;

  try {
    const rig = await loader.loadAsync(rigURL);
    rig.scale.setScalar(0.01);     // adjust if too small/large
    rig.position.y = -1;
    scene.add(rig);
    rigRoot = rig;

    rig.traverse(o => {
      if (o.isMesh) {
        o.material.emissive = new THREE.Color(0x00ff00);
        o.material.emissiveIntensity = 0.25;
      }
    });

    const box    = new THREE.Box3().setFromObject(rig);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3()).length();
    scene.add(new THREE.Box3Helper(box, 0x00ff00));

    camera.position.copy(center.clone().add(new THREE.Vector3(0, size * 0.1, size * 1.3)));
    camera.lookAt(center);

    mixer = new THREE.AnimationMixer(rig);

    if (useFallback) {
      usingFallbackRig = true;
      fallbackClip = rig.animations && rig.animations[0] ? rig.animations[0] : null;
      setStatus(FALLBACK_REASON);
    }
  } catch (err) {
    console.error(err);
    if (!useFallback) {
      setStatus("Failed to load Bob from CDN. Retrying with fallback rig…");
      return loadRig(true);
    }
    setStatus("Could not load fallback rig either. Check network console for details.");
  }
}

async function loadAnim(name) {
  if (usingFallbackRig && fallbackClip) {
    return fallbackClip;
  }
  const loader = new FBXLoader();
  loader.setCrossOrigin("anonymous");
  const fbxURL = FBX_BASE + name + ".fbx";
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
    console.warn("Could not load animation:", name, err);
  }
}

function animate() {
  requestAnimationFrame(animate);
  mixer?.update(clock.getDelta());
  renderer.render(scene, camera);
}

(async () => {
  setStatus("Loading Bob…");
  await waitForGlobals();
  initThree();
  await loadRig();
  await play(START_ANIM);
  if (!usingFallbackRig) {
    setStatus("👂 Listening…");
  }
  animate();
})();

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}