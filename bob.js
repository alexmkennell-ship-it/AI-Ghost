const bobModel = document.getElementById("bob");

// Talk to Bob when user clicks anywhere
document.body.addEventListener("click", async () => {
  const prompt = prompt("Say something to Bob:");
  if (!prompt) return;

  const response = await fetch("https://ghostaiv1.alexmkennell.workers.dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  const data = await response.json();
  const reply = data.reply || "…(spooky silence)…";
  console.log("Bob says:", reply);

  const speech = new SpeechSynthesisUtterance(reply);
  speech.rate = 0.9;
  speechSynthesis.speak(speech);
});
