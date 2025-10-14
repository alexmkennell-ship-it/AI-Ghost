// === CONFIG ===
const PROXY_URL = "https://ghostaiv1.alexmkennell.workers.dev"; // <--- your Cloudflare Worker URL

// === Speech-to-text setup ===
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognizer = SpeechRecognition ? new SpeechRecognition() : null;

if (recognizer) {
  recognizer.lang = "en-US";
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;
}

const subtitleEl = document.getElementById("subtitle");
const talkBtn = document.getElementById("talkBtn");
const stopBtn = document.getElementById("stopBtn");

let speaking = false;

// === Helpers ===
function setSubtitle(text) {
  subtitleEl.textContent = text;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  // choose a slightly eerie voice if available
  const ghostVoice =
    voices.find(v => /UK|Irish|Australian/i.test(v.name)) ||
    voices.find(v => /female/i.test(v.name)) ||
    voices[0];
  if (ghostVoice) utter.voice = ghostVoice;
  utter.rate = 0.95;
  utter.pitch = 0.8;
  speaking = true;
  utter.onend = () => (speaking = false);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// === API call ===
async function askGhost(prompt) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    console.error("Proxy error:", res.status);
    throw new Error("Proxy error");
  }

  const data = await res.json();
  return data.reply;
}

// === Main interaction ===
async function handleInteraction() {
  if (!recognizer) {
    setSubtitle("⚠️ Speech recognition not supported in this browser.");
    return;
  }

  setSubtitle("🎙️ Listening...");
  recognizer.start();

  recognizer.onresult = async (e) => {
    const userText = e.results[0][0].transcript;
    setSubtitle(`🗣️ You: ${userText}`);

    try {
      const reply = await askGhost(userText);
      setSubtitle(reply);
      speak(reply);
    } catch (err) {
      console.error(err);
      setSubtitle("👻 The veil is noisy... try again.");
    }
  };

  recognizer.onerror = (e) => {
    console.warn("Speech recognition error:", e.error);
    setSubtitle("🙊 The ghost heard only whispers...");
  };
}

// === Button events ===
talkBtn.addEventListener("click", handleInteraction);

stopBtn.addEventListener("click", () => {
  if (speaking && window.speechSynthesis) window.speechSynthesis.cancel();
  setSubtitle("🔕 The spirits are quiet.");
});

// Load voices on some browsers
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {};
}
