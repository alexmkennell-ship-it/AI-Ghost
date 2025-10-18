// 🟢 Bob v8.3 — Real Cowboy Render Edition

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const TEXTURE_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

let scene, camera, renderer, clock, mixer, model, currentAction;
let isSpeaking = false;
let asleep = false;

// ---------- SETUP ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  const key = new THREE.DirectionalLight(0xffffff, 0.65);
  key.position.set(2, 4, 3);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-2, 2, -2);
  const rim = new THREE.DirectionalLight(0xffffff, 0.4);
  rim.position.set(0, 3, -3);
  scene.add(hemi, key, fill, rim);

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------- TEXTURE ----------
async function applyOriginalTexture(fbx) {
  const loader = new THREE.TextureLoader();
  const texture = await loader.loadAsync(TEXTURE_URL);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  fbx.traverse(o => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({
        map: texture,
        metalness: 0.25,
        roughness: 0.55,
        envMapIntensity: 0.75,
        emissive: o.name.toLowerCase().includes("eye")
          ? new THREE.Color(0x00ff66)
          : new THREE.Color(0x000000),
        emissiveIntensity: o.name.toLowerCase().includes("eye") ? 0.15 : 0
      });
      o.material.needsUpdate = true;
    }
  });
}

// ---------- MODEL LOAD ----------
async function loadRig() {
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + "T-Pose.fbx");
  fbx.scale.setScalar(1);
  fbx.position.set(0, 0, 0);
  scene.add(fbx);
  model = fbx;
  await applyOriginalTexture(fbx);

  mixer = new THREE.AnimationMixer(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size / 1.5, size / 2.5, size / 1.5)));
  camera.lookAt(center);
  return model;
}

// ---------- ANIMATION ----------
const cache = {};
async function loadClip(name) {
  if (cache[name]) return cache[name];
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + encodeURIComponent(name) + ".fbx");
  const clip = fbx.animations[0];
  cache[name] = clip;
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
  console.log("🤠 Bob action:", name);
}

// ---------- SPEECH ----------
async function say(text) {
  if (isSpeaking) return;
  isSpeaking = true;
  try {
    const resp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "onyx" })
    });
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => {
      isSpeaking = false;
      recognition.start(); // resume listening
    };
    recognition.stop(); // mute mic while speaking
    await audio.play();
  } catch (err) {
    console.warn("⚠️ /tts failed:", err);
    isSpeaking = false;
  }
}

// ---------- CHAT ----------
async function askBob(prompt) {
  const resp = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
  const data = await resp.json();
  const reply = data.reply || "Well shoot, reckon I’m tongue-tied, partner.";
  console.log("💬 Bob says:", reply);
  await say(reply);
}

// ---------- MIC ----------
let recognition;
function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = e => {
    const t = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    console.log("🗣️ You said:", t);
    if (t.includes("hey bob") && asleep) {
      asleep = false;
      play("Neutral Idle");
      say("Mornin’, partner. You woke me up from a dead nap!");
      return;
    }
    if (!asleep && !isSpeaking) askBob(t);
  };

  recognition.onend = () => {
    if (!isSpeaking) recognition.start();
  };
  recognition.start();
  console.log("🟢 Bob: Listening...");
}

// ---------- CAMERA LOOP ----------
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  renderer.render(scene, camera);
}

// ---------- BOOT ----------
(async () => {
  console.log("🟢 Bob v8.3 init");
  try {
    initThree();
    await loadRig();
    await play("Neutral Idle");

    document.body.addEventListener(
      "click",
      () => {
        if (!recognition) initSpeech();
        else console.log("🎤 Mic ready!");
      },
      { once: true }
    );

    animate();
  } catch (err) {
    console.error(err);
  }
})();
