const bob = document.getElementById("bob");
if (!bob) console.warn("⚠️ No <model-viewer id='bob'> found in DOM.");

async function playAnimation(name, duration = 3000) {
  if (!bob) return;
  bob.animationName = name;
  await new Promise(res => setTimeout(res, duration));
  bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
}

// 🎙 Speech Recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "en-US";
recognition.continuous = true;
recognition.interimResults = false;

recognition.onresult = async (event) => {
  const transcript = event.results[event.results.length - 1][0].transcript.trim();
  if (transcript) await talkToBob(transcript);
};

recognition.onend = () => setTimeout(() => recognition.start(), 2000);
recognition.start();

console.log("Bob’s ready for duty!");

// 💬 AI + TTS Logic
async function talkToBob(userInput) {
  try {
    console.log("👂 You said:", userInput);
    await playAnimation("Animation_Talk_Passionately_withSkin", 2000);

    // Step 1: Get AI reply
    const chatResp = await fetch("https://ghostaiv1.alexmkennell.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput }),
    });
    const { reply } = await chatResp.json();
    console.log("💬 Bob:", reply);

    // Step 2: Get audio
    const ttsResp = await fetch("https://ghostaiv1.alexmkennell.workers.dev/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "alloy" }),
    });
    if (!ttsResp.ok) throw new Error("TTS failed");
    const blob = await ttsResp.blob();
    const audioUrl = URL.createObjectURL(blob);

    // Step 3: Play audio
    const audio = new Audio(audioUrl);
    audio.play();

    audio.onplay = () => bob.animationName = "Animation_Talk_Passionately_withSkin";
    audio.onended = () => bob.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
  } catch (err) {
    console.error("Error talking to Bob:", err);
  }
}
