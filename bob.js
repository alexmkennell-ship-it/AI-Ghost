const model = document.getElementById("bob");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

const workerURL = "https://ghostaiv1.alexmkennell.workers.dev/";

// Set Bob’s idle animation
model.addEventListener("load", () => {
  model.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
});

// Listen for button click
sendBtn.addEventListener("click", async () => {
  const text = input.value.trim();
  if (!text) return;

  // Start talking animation (if available)
  model.animationName = "Animation_Agree_Gesture_withSkin";

  try {
    const res = await fetch(workerURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text }),
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    const reply = data.reply || "Hmm... (spooky silence)";
    console.log("Bob says:", reply);

    // Make Bob speak
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.pitch = 0.9;
    utterance.rate = 1;
    speechSynthesis.speak(utterance);

    utterance.onend = () => {
      model.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
    };
  } catch (err) {
    console.error("Error talking to Bob:", err);
    model.animationName = "Animation_Long_Breathe_and_Look_Around_withSkin";
  }

  input.value = "";
});
