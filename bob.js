const workerURL = "https://ghostaiv1.alexmkennell.workers.dev/";

async function talkToBob(prompt) {
  try {
    const response = await fetch(workerURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    console.log("Bob says:", data.reply);

    // Optional voice
    const speak = new SpeechSynthesisUtterance(data.reply);
    speak.rate = 0.9;
    speechSynthesis.speak(speak);
  } catch (err) {
    console.error("Error talking to Bob:", err);
  }
}
