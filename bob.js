console.log("🤠 Booting Bob (v6.6 — I Can See You Now Edition)…");

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const BASE_RIG = "T-Pose.fbx";
const START_ANIM = "Neutral Idle";

let scene, camera, renderer, mixer, rigRoot, clock;
let state = "idle";

// -------- WAIT FOR THREE + FBXLoader --------
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

// -------- MATERIALS --------
const MAT = {
  bone: new THREE.MeshStandardMaterial({ color: 0xd9c7a0, roughness: 0.7, metalness: 0.1 }),
  denim: new THREE.MeshStandardMaterial({ color: 0x3b6ca8, roughness: 0.8 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x87b96e, roughness: 0.8 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x6b4a25, roughness: 0.7 }),
  boots: new THREE.MeshStandardMaterial({ color: 0x4c3216, roughness: 0.9 }),
  eyes: new THREE.MeshStandardMaterial({ color: 0x00ff66, emissive: 0x00ff33, emissiveIntensity: 1 })
};

// -------- HELPERS --------
const findBone = (root, name) => {
  let bone = null;
  root.traverse(o => { if (o.isBone && o.name.includes(name)) bone = o; });
  return bone;
};
const attach = (bone, mesh, offset={x:0,y:0,z:0}) => { if(bone&&mesh){mesh.position.set(offset.x,offset.y,offset.z); bone.add(mesh);}};

// -------- SCENE --------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(3, 5, 2);
  const amb = new THREE.AmbientLight(0xffffff, 0.3); // <-- brighter global fill
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

// -------- COWBOY BODY --------
function buildCowboy(rig) {
  const head = findBone(rig, "Head");
  const spine = findBone(rig, "Spine");
  const spine2 = findBone(rig, "Spine2");
  const lArm = findBone(rig, "LeftArm"), rArm = findBone(rig, "RightArm");
  const lFore = findBone(rig, "LeftForeArm"), rFore = findBone(rig, "RightForeArm");
  const lHand = findBone(rig, "LeftHand"), rHand = findBone(rig, "RightHand");
  const lUpLeg = findBone(rig, "LeftUpLeg"), rUpLeg = findBone(rig, "RightUpLeg");
  const lLeg = findBone(rig, "LeftLeg"), rLeg = findBone(rig, "RightLeg");
  const lFoot = findBone(rig, "LeftFoot"), rFoot = findBone(rig, "RightFoot");

  if (head) {
    attach(head, new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 24), MAT.bone), { y: 0.1 });
    attach(head, new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.1), MAT.bone), { y: -0.02, z: 0.05 });
    attach(head, new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 24), MAT.leather), { y: 0.16 });
    attach(head, new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.11, 24), MAT.leather), { y: 0.23 });
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), MAT.eyes);
    attach(head, e.clone(), { x: 0.035, y: 0.03, z: 0.07 });
    attach(head, e.clone(), { x: -0.035, y: 0.03, z: 0.07 });
  }

  if (spine) attach(spine, new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.25), MAT.shirt), { y: 0.1 });
  if (spine2) attach(spine2, new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.06), MAT.denim), { y: 0.05, z: 0.05 });

  const makeArm=(u,l,h)=>{if(u)attach(u,new THREE.Mesh(new THREE.CapsuleGeometry(0.04,0.18),MAT.shirt),{y:-0.09});
                          if(l)attach(l,new THREE.Mesh(new THREE.CapsuleGeometry(0.035,0.16),MAT.bone),{y:-0.08});
                          if(h)attach(h,new THREE.Mesh(new THREE.BoxGeometry(0.07,0.03,0.08),MAT.bone),{z:0.03});};
  makeArm(lArm,lFore,lHand); makeArm(rArm,rFore,rHand);

  const makeLeg=(u,l,f)=>{if(u)attach(u,new THREE.Mesh(new THREE.CapsuleGeometry(0.055,0.20),MAT.denim),{y:-0.1});
                          if(l)attach(l,new THREE.Mesh(new THREE.CapsuleGeometry(0.045,0.18),MAT.denim),{y:-0.09});
                          if(f)attach(f,new THREE.Mesh(n
