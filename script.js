const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const styleSelect = document.getElementById("styleSelect");
const themeSelect = document.getElementById("themeSelect");
const statusEl = document.getElementById("status");
const idleHint = document.getElementById("idle-hint");

const THEMES = {
  neon: ["#7c5cff", "#22d3ee", "#ff5cc8"],
  fire: ["#ff5722", "#ffb300", "#ffe082"],
  ice: ["#00e5ff", "#2979ff", "#e0f7fa"],
  mono: ["#e8eaf0", "#9aa3b5", "#4b5266"],
};

let audioCtx = null;
let analyser = null;
let dataArray = null;
let bufferLength = 0;
let mediaStream = null;
let animationId = null;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
}
window.addEventListener("resize", resizeCanvas);

function themeColors() {
  return THEMES[themeSelect.value] || THEMES.neon;
}

function draw() {
  animationId = requestAnimationFrame(draw);
  const style = styleSelect.value;
  const [c1, c2, c3] = themeColors();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (style === "bars") {
    analyser.getByteFrequencyData(dataArray);
    const barCount = 96;
    const step = Math.floor(bufferLength / barCount);
    const barWidth = canvas.width / barCount;
    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i * step] || 0;
      const percent = value / 255;
      const barHeight = percent * canvas.height * 0.9;
      const grad = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      const x = i * barWidth;
      ctx.fillRect(x, canvas.height - barHeight, barWidth * 0.8, barHeight);
    }
  } else if (style === "wave") {
    analyser.getByteTimeDomainData(dataArray);
    ctx.lineWidth = 3 * window.devicePixelRatio;
    ctx.strokeStyle = c2;
    ctx.beginPath();
    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  } else if (style === "circle") {
    analyser.getByteFrequencyData(dataArray);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const baseRadius = Math.min(canvas.width, canvas.height) * 0.2;
    const barCount = 120;
    const step = Math.floor(bufferLength / barCount);
    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i * step] || 0;
      const percent = value / 255;
      const angle = (i / barCount) * Math.PI * 2;
      const len = baseRadius * 0.3 + percent * baseRadius * 1.4;
      const x1 = cx + Math.cos(angle) * baseRadius;
      const y1 = cy + Math.sin(angle) * baseRadius;
      const x2 = cx + Math.cos(angle) * (baseRadius + len);
      const y2 = cy + Math.sin(angle) * (baseRadius + len);
      ctx.strokeStyle = i % 2 === 0 ? c1 : c3;
      ctx.lineWidth = 2 * window.devicePixelRatio;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
}

async function start() {
  try {
    statusEl.textContent = "Requesting audio source…";

    // Video track is required by the browser to allow tab/screen capture with audio,
    // but we only use the audio track — video is discarded immediately.
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) {
      statusEl.textContent =
        "No audio track received — make sure to check 'Share tab audio' / 'Share system audio' in the picker.";
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
      return;
    }

    mediaStream.getVideoTracks().forEach((t) => t.stop());

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);

    audioTracks[0].addEventListener("ended", stop);

    resizeCanvas();
    draw();

    idleHint.style.display = "none";
    statusEl.textContent = "Capturing audio — visualizing live.";
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    console.error(err);
    if (err.name === "NotAllowedError") {
      statusEl.textContent = "Permission denied — capture cancelled.";
    } else {
      statusEl.textContent = "Could not start capture: " + err.message;
    }
  }
}

function stop() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  idleHint.style.display = "block";
  statusEl.textContent = "Idle — no audio source connected.";
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

resizeCanvas();
