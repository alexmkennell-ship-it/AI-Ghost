// bob.js — Expressive Build 2.1
// Adds micLock (no self-talk) + deeper raspy "copper" cowboy voice

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
let micLocked = false; // 🔇 prevents mic from hearing itself

// ...[keep all existing code from 2.0 above speakAndAnimate unchanged]...

// -------------------------------------------------------
// Voice & talking (smart + synced + micLock + deep cowboy tone)
// -------------------------------------------------------
let abortSpeech = null;
async function speakAndAnimate(userText) {
  if (!userText) return;

  try {
    state = "talking";
    stopMicroIdle();
    setStatus("💬 Thinking...");

    // 1) get AI reply
    const chatResp = await fetch(`${WORKER_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userText }),
    });
    const data = await chatResp.json();
    const replyText = data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖 Bob says:", replyText);

    setEmotionEyesFromText(replyText);

    // 2) TTS (raspy cowboy)
    const ac = new AbortController();
    abortSpeech = () => ac.abort();

    const resp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText, voice: "copper" }),
      signal: ac.signal,
    });

    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength < 1000) {
      console.warn("⚠️ Worker returned short or invalid audio response.");
      setStatus("⚠️ Invalid audio response");
      state = "idle";
      startMicroIdle();
      return;
    }

    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = 0.9; // ⚙️ slower, heavier drawl

    // 🔇 Lock mic during playback
    micLocked = true;
    if (window.recognition) { try { window.recognition.stop(); } catch {} }

    // talk anim starts exactly when audio starts
    let talkStarted = false;
    audio.addEventListener("play", async () => {
      if (talkStarted) return;
      talkStarted = true;
      await setAnim(pick(talkPool), { minHoldMs: 0, blendMs: 350 });
      const loopTick = () => {
        if (state !== "talking" || audio.paused || audio.ended) return;
        setTimeout(() => {
          if (state === "talking" && !audio.ended) {
            setAnim(pick(talkPool), { minHoldMs: 0, blendMs: 300 });
            loopTick();
          }
        }, 2000 + Math.random() * 500);
      };
      loopTick();
      startAmplitudeDriveFor(audio);
    }, { once: true });

    await audio.play().catch(console.warn);

    audio.onended = async () => {
      stopAmplitudeDrive();
      URL.revokeObjectURL(url);
      state = "idle";
      setStatus("👂 Listening...");
      await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 600, blendMs: 500 });

      // 🔊 Unlock mic after playback
      micLocked = false;
      if (window.recognition) { try { window.recognition.start(); } catch {} }

      startMicroIdle();
    };
  } catch (err) {
    console.error("Speech error:", err);
    stopAmplitudeDrive();
    setStatus("⚠️ Speech error — see console");
    state = "idle";
    micLocked = false;
    startMicroIdle();
  }
}

// -------------------------------------------------------
// Microphone setup (respect micLock on onend)
// -------------------------------------------------------
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition) {
  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = "en-US";
  window.recognition = rec;

  rec.onresult = async (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.trim();
    if (transcript.length > 0) {
      console.log("🎤 Heard:", transcript);
      await speakAndAnimate(transcript);
    }
  };
  rec.onerror = (e) => console.warn("Speech recognition error:", e.error);
  rec.onend = () => {
    if (!micLocked && state === "idle") rec.start(); // ✅ respect lock
  };

  window.addEventListener("click", () => {
    try {
      rec.start();
      setStatus("👂 Listening (mic on)...");
    } catch (err) { console.warn("Mic start error:", err); }
  }, { once: true });
} else {
  console.warn("SpeechRecognition not supported in this browser.");
}

// ...[rest of boot + idle/sleep logic unchanged]...
