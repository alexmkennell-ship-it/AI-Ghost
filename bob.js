const bob = document.getElementById("bob");

// Define all animation sequences
const animations = {
  idle: ["bobidle1.png", "bobidle2.png", "bobidlelookleft.png", "bobidlelookright.png"],
  wave: ["bobwavecenter.png", "bobwaveleft.png", "bobwavecenter.png", "bobwaveright.png", "bobwavecenter.png"],
  talk: ["bobmouthclosed.png", "bobmouthopenmid.png", "bobmouthopen.png", "bobmouthopenmid.png"],
};

let state = "idle";
let frame = 0;
let animInterval = null;

function playAnimation(type, loop = true, frameDelay = 200, callback = null) {
  clearInterval(animInterval);
  const frames = animations[type];
  frame = 0;
  state = type;

  animInterval = setInterval(() => {
    bob.src = `images/${frames[frame]}`;
    frame++;

    if (frame >= frames.length) {
      if (loop) {
        frame = 0;
      } else {
        clearInterval(animInterval);
        if (callback) callback();
      }
    }
  }, frameDelay);
}

// Idle animation loops forever
function startIdle() {
  playAnimation("idle", true, 300);
}

// Wave once, then talk, then return to idle
function startConversation() {
  playAnimation("wave", false, 200, () => {
    playAnimation("talk", true, 120);
    // talk for a few seconds, then idle
    setTimeout(() => startIdle(), 5000);
  });
}

// Start idle loop
startIdle();

// Start conversation when page is clicked
document.body.addEventListener("click", () => {
  if (state !== "wave" && state !== "talk") {
    startConversation();
  }
});
