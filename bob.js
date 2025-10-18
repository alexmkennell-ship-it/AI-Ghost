console.log("🤠 Booting Bob (v6.4 — Real Cowboy Mode)…");

const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const BASE_RIG = "T-Pose.fbx";
const START_ANIM = "Neutral Idle";

let scene, camera, renderer, mixer, rigRoot;
const clock = new THREE.Clock();

// ---------- materials ----------
const MAT = {
  bone: new THREE.MeshStandardMaterial({ color: 0xd9c7a0, roughness: 1 }),
  denim: new THREE.MeshStandardMaterial({ color: 0x3b6ca8, roughness: 1 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x87b96e, roughness: 1 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x6b4a25, roughness: 1 }),
  boots: new THREE.MeshStandardMaterial({ color: 0x4c3216, roughness: 1 }),
  eyes: new THREE.MeshStandardMaterial({ color: 0x00ff66, emissive: 0x00ff33, emissiveIntensity: 1 })
};

// ---------- helpers ----------
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

// ---------- scene setup ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.5, 3.2);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.8);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
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

// ---------- build cowboy ----------
function buildCowboy(rig) {
  const head = findBone(rig, "Head");
  const neck = findBone(rig, "Neck");
  const spine = findBone(rig, "Spine");
  const spine2 = findBone(rig, "Spine2");
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

  // head
  if (head) {
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 24), MAT.bone);
    attach(head, skull, { y: 0.1 });
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.1), MAT.bone);
    attach(head, jaw, { y: -0.02, z: 0.05 });

    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 24), MAT.leather);
    attach(head, brim, { y: 0.16 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.11, 24), MAT.leather);
    attach(head, crown, { y: 0.23 });

    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), MAT.eyes);
    const eyeL = eyeR.clone();
    attach(head, eyeR, { x: 0.035, y: 0.03, z: 0.07 });
    attach(head, eyeL, { x: -0.035, y: 0.03, z: 0.07 });
  }

  // torso
  if (spine) {
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.25, 8, 16), MAT.shirt);
    attach(spine, torso, { y: 0.1 });
  }
  if (spine2) {
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.06), MAT.denim);
    attach(spine2, bib, { y: 0.05, z: 0.05 });
  }

  // arms
  const makeArm = (upper, lower, hand) => {
    if (upper) attach(upper, new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.18), MAT.shirt), { y: -0.09 });
    if (lower) attach(lower, new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16), MAT.bone), { y: -0.08 });
    if (hand) attach(hand, new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.08), MAT.bone), { z: 0.03 });
  };
  makeArm(lArm, lFore, lHand);
  makeArm(rArm, rFore, rHand);

  // legs
  const makeLeg = (upper, lower, foot) => {
    if (upper) attach(upper, new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.20), MAT.denim), { y: -0.1 });
    if (lower) attach(lower, new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.18), MAT.denim), { y: -0.09 });
    if (foot) attach(foot, new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.05), MAT.boots), { z: 0.05 });
  };
  makeLeg(lUpLeg, lLeg, lFoot);
  makeLeg(rUpLeg, rLeg, rFoot);
}

// ---------- load rig & animation ----------
async function loadRig() {
  const loader = new FBXLoader();
  const rig = await loader.loadAsync(FBX_BASE + BASE_RIG);
  rig.scale.setScalar(0.01);
  rig.position.y = -1;
  scene.add(rig);
  rigRoot = rig;
  buildCowboy(rigRoot);

  // frame camera
  const box = new THREE.Box3().setFromObject(rigRoot);
  const center = box.getCenter(new THREE.Vector3());
  camera.position.set(center.x, center.y + 0.3, center.z + 2.8);
  camera.lookAt(center);

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
  action.play();
}

// ---------- loop ----------
function animate() {
  requestAnimationFrame(animate);
  mixer?.update(clock.getDelta());
  renderer.render(scene, camera);
}

// ---------- boot ----------
(async () => {
  document.getElementById("status").textContent = "Loading Bob...";
  await new Promise(r => setTimeout(r, 200)); // small delay to ensure THREE ready
  initThree();
  await loadRig();
  await play(START_ANIM);
  document.getElementById("status").textContent = "👂 Listening...";
  animate();
})();
