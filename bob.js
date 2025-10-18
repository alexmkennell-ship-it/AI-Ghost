console.log("🟢 Booting Bob (v6.2 — Procedural Cowboy)…");

// ---------- CONFIG ----------
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const BASE_RIG = "T-Pose.fbx"; // Mixamo base rig
const START_ANIM = "Neutral Idle"; // animation name (no .fbx)

// ---------- VERIFY GLOBALS ----------
if (typeof window.FBXLoader === "undefined" && window.THREE && THREE.FBXLoader) {
  window.FBXLoader = THREE.FBXLoader;
  console.log("🧩 FBXLoader patched to global scope.");
}
if (typeof THREE === "undefined" || typeof FBXLoader === "undefined")
  throw new Error("❌ THREE.js or FBXLoader missing.");

// ---------- UTILS ----------
const setStatus = (m) => (document.getElementById("status").textContent = m);
const cache = {};
const deg = (a) => a * Math.PI / 180;
const findBone = (root, name) => {
  let bone = null;
  root.traverse(o => {
    if (o.isBone && o.name.includes(name)) bone = o;
  });
  return bone;
};
const attach = (bone, mesh, offset = {x:0,y:0,z:0}) => {
  if (!bone || !mesh) return;
  mesh.position.set(offset.x, offset.y, offset.z);
  bone.add(mesh);
};

// ---------- GLOBALS ----------
let scene, camera, renderer, clock, mixer, rigRoot, currentAction;

// ---------- INIT ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.5, 3.2);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.7);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 4, 2);
  scene.add(hemi, dir);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5, 40),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.0;
  scene.add(ground);

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------- MATERIALS ----------
const MAT = {
  bone: new THREE.MeshStandardMaterial({ color: 0xd9c7a0, roughness: 1, metalness: 0 }),
  denim: new THREE.MeshStandardMaterial({ color: 0x3b6ca8, roughness: 1, metalness: 0 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x8cb879, roughness: 1, metalness: 0 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x7b5e2b, roughness: 1, metalness: 0 }),
  boots: new THREE.MeshStandardMaterial({ color: 0x5a3d1b, roughness: 1, metalness: 0 }),
  eyes: new THREE.MeshStandardMaterial({ color: 0x00ff66, emissive: 0x007733, emissiveIntensity: 1.0 })
};

// ---------- PROCEDURAL BUILD ----------
function buildBob(rig) {
  const hips = findBone(rig, "Hips");
  const spine = findBone(rig, "Spine");
  const spine2 = findBone(rig, "Spine2");
  const neck = findBone(rig, "Neck");
  const head = findBone(rig, "Head");
  const lArm = findBone(rig, "LeftArm");
  const rArm = findBone(rig, "RightArm");
  const lFore = findBone(rig, "LeftForeArm");
  const rFore = findBone(rig, "RightForeArm");
  const lHand = findBone(rig, "LeftHand");
  const rHand = findBone(rig, "RightHand");
  const lUpLeg = findBone(rig, "LeftUpLeg");
  const rUpLeg = findBone(rig, "RightUpLeg");
  const lLeg = findBone(rig, "LeftLeg");
  const rLeg = findBone(rig, "RightLeg");
  const lFoot = findBone(rig, "LeftFoot");
  const rFoot = findBone(rig, "RightFoot");

  // Skull + hat
  if (head) {
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 24), MAT.bone);
    attach(head, skull, { y: 0.08 });

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.1), MAT.bone);
    attach(head, jaw, { y: -0.02, z: 0.05 });

    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 24), MAT.leather);
    attach(head, brim, { y: 0.14 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.11, 24), MAT.leather);
    attach(head, crown, { y: 0.20 });

    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), MAT.eyes);
    const eyeL = eyeR.clone();
    attach(head, eyeR, { x: 0.035, y: 0.03, z: 0.07 });
    attach(head, eyeL, { x: -0.035, y: 0.03, z: 0.07 });
  }

  // Torso
  if (spine) {
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.25, 8, 16), MAT.shirt);
    attach(spine, torso, { y: 0.1 });
  }

  // Overalls bib
  if (spine2) {
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.06), MAT.denim);
    attach(spine2, bib, { y: 0.0, z: 0.05 });
  }

  // Arms
  const mkArm = (armBone, foreBone, handBone, side) => {
    if (armBone) {
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.18, 8, 12), MAT.shirt);
      attach(armBone, sleeve, { y: -0.09 });
    }
    if (foreBone) {
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 8, 12), MAT.bone);
      attach(foreBone, fore, { y: -0.08 });
    }
    if (handBone) {
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.08), MAT.bone);
      attach(handBone, palm, { y: -0.02, z: 0.03 });
    }
  };
  mkArm(lArm, lFore, lHand, "L");
  mkArm(rArm, rFore, rHand, "R");

  // Legs + boots
  const mkLeg = (upper, lower, foot) => {
    if (upper) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.20, 8, 16), MAT.denim);
      attach(upper, thigh, { y: -0.1 });
    }
    if (lower) {
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.18, 8, 16), MAT.denim);
      attach(lower, shin, { y: -0.09 });
    }
    if (foot) {
      const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.05, 8, 16), MAT.boots);
      attach(foot, boot, { z: 0.05 });
    }
  };
  mkLeg(lUpLeg, lLeg, lFoot);
  mkLeg(rUpLeg, rLeg, rFoot);
}

// ---------- LOAD & RUN ----------
async function loadRig() {
  const loader = new FBXLoader();
  const rig = await loader.loadAsync(FBX_BASE + BASE_RIG);
  rig.scale.setScalar(0.01); // works for Mixamo scale
  rig.position.y = -1.0;
  scene.add(rig);
  rigRoot = rig;
  buildBob(rigRoot);
  mixer = new THREE.AnimationMixer(rigRoot);
}

async function loadAnim(name) {
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + name + ".fbx");
  return fbx.animations[0];
}

async function play(name) {
  const clip = await loadAnim(name);
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  if (currentAction) currentAction.crossFadeTo(action, 0.4, false);
  action.play();
  currentAction = action;
}

// ---------- LOOP ----------
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  renderer.render(scene, camera);
}

// ---------- BOOT ----------
async function boot() {
  setStatus("Initializing Bob...");
  initThree();
  await loadRig();
  await play(START_ANIM);
  setStatus("👂 Listening...");
  animate();
}

boot().catch(e => {
  console.error(e);
  setStatus("❌ Load error.");
});
