const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const styleSelect = document.getElementById("styleSelect");
const themeSelect = document.getElementById("themeSelect");
const intensitySlider = document.getElementById("intensitySlider");
const hintEl = document.getElementById("hint");
const taskbar = document.getElementById("taskbar");
const drawCanvas = document.getElementById("drawCanvas");
const dctx = drawCanvas.getContext("2d");

const DEFAULT_HINT =
  'Click <a href="#" id="hintStart" class="hint-link">Start</a>, then in the picker choose the browser tab / window / screen ' +
  'that\'s playing audio, and make sure <strong>"Share audio"</strong> (or "Share tab audio") is checked.';

let audioCtx = null;
let analyser = null;
let dataArray = null;
let bufferLength = 0;
let mediaStream = null;
let animationId = null;
let capturing = false;

// ---------- canvas sizing (full viewport) ----------
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  drawCanvas.width = window.innerWidth * dpr;
  drawCanvas.height = window.innerHeight * dpr;
}
window.addEventListener("resize", resizeCanvas);

// ---------- color harmonies ----------
function hsl(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, ${s}%, ${l}%)`;
}

function palette(themeName, t) {
  const hue = (t * 0.012) % 360;
  switch (themeName) {
    case "complementary":
      return [hsl(hue, 85, 62), hsl(hue + 180, 85, 62), hsl(hue + 180, 60, 40)];
    case "triadic":
      return [hsl(hue, 78, 60), hsl(hue + 120, 78, 60), hsl(hue + 240, 78, 60)];
    case "analogous":
      return [hsl(hue - 30, 78, 58), hsl(hue, 85, 62), hsl(hue + 30, 78, 58)];
    case "sunset":
      return [
        hsl(24 + Math.sin(t / 4000) * 10, 92, 58),
        hsl(345 + Math.sin(t / 3200) * 10, 82, 52),
        hsl(46, 96, 66),
      ];
    case "aurora":
      return [
        hsl(160 + Math.sin(t / 3000) * 40, 72, 55),
        hsl(200 + Math.cos(t / 4200) * 30, 72, 58),
        hsl(280 + Math.sin(t / 5200) * 30, 70, 62),
      ];
    case "mono":
    default:
      return [hsl(hue, 8, 92), hsl(hue, 8, 62), hsl(hue, 8, 36)];
  }
}

// ---------- visualization styles ----------
// intensityFrac ranges ~0.3 (min) .. ~0.95 (max, i.e. flare/bars can reach almost to the top)

// Frequency bins are linear, but music energy is concentrated below ~5kHz —
// with 1024 bins spanning to ~22kHz, sampling linearly wastes most columns on
// near-silent treble. Map screen position to bin index on a log curve instead,
// like a real spectrum analyzer/mixer, so low/mid frequencies (where the
// energy actually is) get most of the width.
function freqIndexAt(xFrac, bufferLength) {
  const idx = Math.pow(bufferLength, xFrac) - 1;
  return Math.min(bufferLength - 1, Math.max(0, Math.floor(idx)));
}

// Mild perceptual boost so quiet content still reads, without flattening
// the natural peaks/valleys into a solid wall — the log remap above already
// does the heavy lifting for balancing low vs. high frequencies.
function boostValue(raw) {
  return Math.min(1, Math.sqrt(raw));
}

function sampleAt(dataArray, bufferLength, xFrac) {
  const idx = freqIndexAt(xFrac, bufferLength);
  const raw = (dataArray[idx] || 0) / 255;
  return boostValue(raw);
}

function drawSolar(dataArray, bufferLength, colors, intensityFrac, t) {
  const w = canvas.width;
  const h = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  const baseY = h;
  const maxHeight = h * intensityFrac;

  const points = 56;

  // asymmetrical, unpredictable silhouette: audio value shaped by several
  // independent, non-harmonically-related noise waves so it never mirrors itself
  function heightAt(i, heightScale) {
    const xFrac = i / (points - 1);
    const value = sampleAt(dataArray, bufferLength, xFrac);
    const noise =
      Math.sin(xFrac * 2.7 + t * 0.00035) * 0.24 +
      Math.sin(xFrac * 6.1 - t * 0.00061 + 1.9) * 0.15 +
      Math.sin(xFrac * 11.3 + t * 0.00089 + 4.4) * 0.09 +
      Math.sin(xFrac * 1.3 - t * 0.00021 + 2.6) * 0.19;
    const shaped = Math.max(0.02, value * (0.6 + noise));
    return maxHeight * heightScale * (0.06 + shaped * 0.95);
  }

  function drawLayer(heightScale, alpha, colorBottom, colorTop, blurPx) {
    const pts = [];
    for (let i = 0; i < points; i++) {
      pts.push([(i / (points - 1)) * w, baseY - heightAt(i, heightScale)]);
    }

    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length - 2; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      ctx.quadraticCurveTo(x0, y0, mx, my);
    }
    const last = pts[pts.length - 1];
    const secondLast = pts[pts.length - 2];
    ctx.quadraticCurveTo(secondLast[0], secondLast[1], last[0], last[1]);
    ctx.lineTo(w, baseY);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, baseY, 0, baseY - maxHeight * heightScale);
    grad.addColorStop(0, colorBottom);
    grad.addColorStop(0.55, colorTop);
    grad.addColorStop(1, "transparent");

    ctx.save();
    ctx.filter = blurPx ? `blur(${blurPx * dpr}px)` : "none";
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // stacked, increasingly-blurred layers blend into one soft, smooth glow
  // instead of a sharp-edged shape — like a blurred, blended flare
  drawLayer(1.35, 0.3, colors[0], colors[1], 46);
  drawLayer(1.05, 0.4, colors[1], colors[2] || colors[0], 28);
  drawLayer(0.85, 0.5, colors[0], colors[1], 14);
  drawLayer(0.68, 0.55, colors[1], colors[2] || colors[0], 4);
}

function draw8bit(dataArray, bufferLength, colors, intensityFrac) {
  const dpr = window.devicePixelRatio || 1;
  const cell = 7 * dpr; // extra small block, lots of mountain peaks across the width
  const gap = cell * 0.14;
  const cols = Math.max(8, Math.floor(canvas.width / cell));
  const maxBarHeight = canvas.height * intensityFrac;

  for (let i = 0; i < cols; i++) {
    const xFrac = i / (cols - 1);
    const value = sampleAt(dataArray, bufferLength, xFrac);
    const blocks = Math.round((value * maxBarHeight) / cell);
    const x = i * cell + gap / 2;
    for (let r = 0; r < blocks; r++) {
      const y = canvas.height - (r + 1) * cell;
      ctx.fillStyle = colors[r % colors.length];
      ctx.fillRect(x, y + gap / 2, cell - gap, cell - gap);
    }
  }
}

const ASCII_WORDS = ["LIVE", "LOVE", "ABC", "LETSGOO", "VIBE", "BASS", "BEAT", "FLOW", "YES", "GO", "WOW", "PLAY", "GROOVE", "PULSE"];
let asciiWords = [];
let lastWordSpawn = 0;

function maybeSpawnAsciiWord(avgEnergy, t, w, h) {
  if (avgEnergy > 0.5 && t - lastWordSpawn > 220 && Math.random() < 0.55) {
    lastWordSpawn = t;
    asciiWords.push({
      text: ASCII_WORDS[Math.floor(Math.random() * ASCII_WORDS.length)],
      x: 40 + Math.random() * (w - 80),
      y: h * (0.1 + Math.random() * 0.6),
      born: t,
      life: 850 + Math.random() * 500,
      colorSeed: Math.random(),
    });
  }
  asciiWords = asciiWords.filter((wd) => t - wd.born < wd.life);
}

function drawAsciiWords(colors, t) {
  const dpr = window.devicePixelRatio || 1;
  for (const wd of asciiWords) {
    const age = (t - wd.born) / wd.life;
    const alpha = age < 0.2 ? age / 0.2 : age > 0.7 ? Math.max(0, (1 - age) / 0.3) : 1;
    const scale = 0.85 + Math.sin(age * Math.PI) * 0.3;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${Math.floor(24 * dpr * scale)}px "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colors[Math.floor(wd.colorSeed * colors.length)];
    ctx.shadowColor = colors[0];
    ctx.shadowBlur = 14 * dpr;
    ctx.fillText(wd.text, wd.x, wd.y);
    ctx.restore();
  }
}

function drawAscii(dataArray, bufferLength, colors, intensityFrac, t) {
  const chars = " .:-=+*#%@";
  const dpr = window.devicePixelRatio || 1;
  const cellSize = 9 * dpr;
  const cols = Math.max(20, Math.floor(canvas.width / cellSize));
  const rows = Math.max(10, Math.floor(canvas.height / cellSize));
  const maxFilled = rows * intensityFrac * 1.3;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.floor(cellSize * 0.95)}px "Courier New", monospace`;

  let sum = 0;
  for (let x = 0; x < cols; x++) {
    const xFrac = x / (cols - 1);
    const value = sampleAt(dataArray, bufferLength, xFrac);
    sum += value;
    const filled = Math.min(rows, Math.round(value * maxFilled));
    for (let y = 0; y < filled; y++) {
      const px = x * cellSize + cellSize / 2;
      const py = canvas.height - y * cellSize - cellSize / 2;
      const density = Math.min(chars.length - 1, 1 + Math.floor((y / rows) * (chars.length - 1)));
      ctx.fillStyle = colors[y % colors.length];
      ctx.fillText(chars[density], px, py);
    }
  }

  const avgEnergy = sum / cols;
  maybeSpawnAsciiWord(avgEnergy, t, canvas.width, canvas.height);
  drawAsciiWords(colors, t);
}

function draw() {
  animationId = requestAnimationFrame(draw);
  const t = performance.now();
  const style = styleSelect.value;
  const colors = palette(themeSelect.value, t);
  const intensityFrac = 0.3 + (intensitySlider.value / 100) * 0.65;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (style === "solar") {
    analyser.getByteFrequencyData(dataArray);
    drawSolar(dataArray, bufferLength, colors, intensityFrac, t);
  } else if (style === "bit8") {
    analyser.getByteFrequencyData(dataArray);
    draw8bit(dataArray, bufferLength, colors, intensityFrac);
  } else if (style === "ascii") {
    analyser.getByteFrequencyData(dataArray);
    drawAscii(dataArray, bufferLength, colors, intensityFrac, t);
  }
}

// ---------- capture ----------
async function start() {
  try {
    setHint(DEFAULT_HINT, false);
    setHint("Requesting audio source&hellip;");

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
      setHint(
        "No audio track received &mdash; make sure to check &quot;Share tab audio&quot; / &quot;Share system audio&quot; in the picker."
      );
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
      return;
    }

    mediaStream.getVideoTracks().forEach((t) => t.stop());

    // Chrome switches the active tab to whatever was picked in the share
    // dialog — pull focus straight back to this page.
    window.focus();

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

    capturing = true;
    hintEl.classList.add("hidden");
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    console.error(err);
    if (err.name === "NotAllowedError") {
      setHint("Permission denied &mdash; capture cancelled.");
    } else {
      setHint("Could not start capture: " + err.message);
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
  capturing = false;
  setHint(DEFAULT_HINT);
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

function setHint(html, show = true) {
  hintEl.innerHTML = html;
  hintEl.classList.toggle("hidden", !show);
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

hintEl.addEventListener("click", (e) => {
  if (e.target.id === "hintStart") {
    e.preventDefault();
    start();
  }
});

// ---------- auto-hide taskbar ----------
const HOVER_ZONE = 110;
const HIDE_DELAY = 2500;
const HIDE_DELAY_QUICK = 350;
let hideTimeout = null;
let taskbarPinned = false;

function showTaskbar() {
  taskbar.classList.remove("hidden");
  scheduleHide(HIDE_DELAY);
}

function scheduleHide(delay) {
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    if (!taskbarPinned) taskbar.classList.add("hidden");
  }, delay);
}

window.addEventListener("mousemove", (e) => {
  if (window.innerHeight - e.clientY < HOVER_ZONE) showTaskbar();
});
window.addEventListener("touchstart", (e) => {
  const touch = e.touches[0];
  if (touch && window.innerHeight - touch.clientY < HOVER_ZONE) showTaskbar();
});

taskbar.addEventListener("mouseenter", () => {
  taskbarPinned = true;
  showTaskbar();
});
taskbar.addEventListener("mouseleave", () => {
  taskbarPinned = false;
  scheduleHide(HIDE_DELAY_QUICK);
});

[styleSelect, themeSelect, intensitySlider].forEach((el) => {
  el.addEventListener("focus", () => {
    taskbarPinned = true;
    showTaskbar();
  });
  el.addEventListener("blur", () => {
    taskbarPinned = false;
    scheduleHide(HIDE_DELAY_QUICK);
  });
});

// ---------- GIF sticker dock ----------
const stickerLayer = document.getElementById("stickerLayer");
const gifDock = document.getElementById("gifDock");
const gifItems = document.querySelectorAll(".gif-item");

const DOCK_HOVER_ZONE = 110;
const DOCK_HIDE_DELAY = 2500;
const DOCK_HIDE_DELAY_QUICK = 350;
let dockHideTimeout = null;
let dockPinned = false;

function showGifDock() {
  gifDock.classList.remove("hidden");
  scheduleGifDockHide(DOCK_HIDE_DELAY);
}

function scheduleGifDockHide(delay) {
  clearTimeout(dockHideTimeout);
  dockHideTimeout = setTimeout(() => {
    if (!dockPinned) gifDock.classList.add("hidden");
  }, delay);
}

window.addEventListener("mousemove", (e) => {
  if (e.clientX < DOCK_HOVER_ZONE) showGifDock();
});
window.addEventListener("touchstart", (e) => {
  const touch = e.touches[0];
  if (touch && touch.clientX < DOCK_HOVER_ZONE) showGifDock();
});

gifDock.addEventListener("mouseenter", () => {
  dockPinned = true;
  showGifDock();
});
gifDock.addEventListener("mouseleave", () => {
  dockPinned = false;
  scheduleGifDockHide(DOCK_HIDE_DELAY_QUICK);
});

function makeDraggable(el) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".remove-btn") || e.target.closest(".resize-handle")) return;
    dragging = true;
    el.classList.add("dragging");
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    el.style.left = `${e.clientX - offsetX}px`;
    el.style.top = `${e.clientY - offsetY}px`;
  });
  el.addEventListener("pointerup", (e) => {
    dragging = false;
    el.classList.remove("dragging");
    try {
      el.releasePointerCapture(e.pointerId);
    } catch (_) {}
  });
}

function makeResizable(el) {
  const handle = document.createElement("div");
  handle.className = "resize-handle";
  el.appendChild(handle);

  let resizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    resizing = true;
    startX = e.clientX;
    startWidth = el.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const newWidth = Math.min(560, Math.max(70, startWidth + (e.clientX - startX)));
    el.style.width = `${newWidth}px`;
  });
  handle.addEventListener("pointerup", (e) => {
    resizing = false;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch (_) {}
  });
}

function createSticker(src, aspectRatio, x, y) {
  const size = 160;
  const left = Math.min(Math.max(x - size / 2, 8), window.innerWidth - size - 8);
  const top = Math.min(Math.max(y - size / 2, 8), window.innerHeight - size - 8);

  const el = document.createElement("div");
  el.className = "gif-sticker";
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.aspectRatio = String(aspectRatio || 1);

  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.draggable = false;
  el.appendChild(img);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.title = "Remove";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.remove();
  });
  el.appendChild(removeBtn);

  makeDraggable(el);
  makeResizable(el);
  stickerLayer.appendChild(el);
  return el;
}

// dragging a thumbnail out of the dock places a new sticker on the screen
let ghostEl = null;
let ghostSrc = null;
let ghostAspect = 1;

gifItems.forEach((item) => {
  item.addEventListener("pointerdown", (e) => {
    ghostSrc = item.dataset.src;
    ghostAspect = parseFloat(item.dataset.aspect) || 1;
    ghostEl = document.createElement("div");
    ghostEl.className = "gif-ghost";
    ghostEl.style.left = `${e.clientX - 32}px`;
    ghostEl.style.top = `${e.clientY - 32}px`;
    ghostEl.style.backgroundImage = `url("${ghostSrc}")`;
    ghostEl.style.backgroundSize = "cover";
    document.body.appendChild(ghostEl);
    item.setPointerCapture(e.pointerId);
    dockPinned = true;
    showGifDock();
  });

  item.addEventListener("pointermove", (e) => {
    if (!ghostEl) return;
    ghostEl.style.left = `${e.clientX - 32}px`;
    ghostEl.style.top = `${e.clientY - 32}px`;
  });

  item.addEventListener("pointerup", (e) => {
    if (ghostEl) {
      createSticker(ghostSrc, ghostAspect, e.clientX, e.clientY);
      ghostEl.remove();
      ghostEl = null;
    }
    dockPinned = false;
    scheduleGifDockHide(DOCK_HIDE_DELAY_QUICK);
  });
});

// ---------- right tool dock (draw / erase / text) ----------
const rightDock = document.getElementById("rightDock");
const drawToolBtn = document.getElementById("drawToolBtn");
const eraseToolBtn = document.getElementById("eraseToolBtn");
const textToolBtn = document.getElementById("textToolBtn");
const clearDrawBtn = document.getElementById("clearDrawBtn");
const colorSwatches = document.querySelectorAll(".swatch");
const brushSizeSlider = document.getElementById("brushSizeSlider");
const brushHardnessSlider = document.getElementById("brushHardnessSlider");
const textLayer = document.getElementById("textLayer");

const RIGHT_HOVER_ZONE = 110;
const RIGHT_HIDE_DELAY = 2500;
const RIGHT_HIDE_DELAY_QUICK = 350;
let rightHideTimeout = null;
let rightPinned = false;

function showRightDock() {
  rightDock.classList.remove("hidden");
  scheduleRightHide(RIGHT_HIDE_DELAY);
}

function scheduleRightHide(delay) {
  clearTimeout(rightHideTimeout);
  rightHideTimeout = setTimeout(() => {
    if (!rightPinned) rightDock.classList.add("hidden");
  }, delay);
}

window.addEventListener("mousemove", (e) => {
  if (window.innerWidth - e.clientX < RIGHT_HOVER_ZONE) showRightDock();
});
window.addEventListener("touchstart", (e) => {
  const touch = e.touches[0];
  if (touch && window.innerWidth - touch.clientX < RIGHT_HOVER_ZONE) showRightDock();
});

rightDock.addEventListener("mouseenter", () => {
  rightPinned = true;
  showRightDock();
});
rightDock.addEventListener("mouseleave", () => {
  rightPinned = false;
  scheduleRightHide(RIGHT_HIDE_DELAY_QUICK);
});

let activeTool = null; // "draw" | "erase" | "text" | null
let selectedColor = "#ffffff";

function setActiveTool(tool) {
  activeTool = activeTool === tool ? null : tool;
  drawToolBtn.classList.toggle("active", activeTool === "draw");
  eraseToolBtn.classList.toggle("active", activeTool === "erase");
  textToolBtn.classList.toggle("active", activeTool === "text");
  drawCanvas.style.pointerEvents = activeTool === "draw" || activeTool === "erase" ? "auto" : "none";
  textLayer.style.pointerEvents = activeTool === "text" ? "auto" : "none";
}

drawToolBtn.addEventListener("click", () => setActiveTool("draw"));
eraseToolBtn.addEventListener("click", () => setActiveTool("erase"));
textToolBtn.addEventListener("click", () => setActiveTool("text"));

clearDrawBtn.addEventListener("click", () => {
  dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
});

colorSwatches.forEach((sw) => {
  sw.addEventListener("click", () => {
    selectedColor = sw.dataset.color;
    colorSwatches.forEach((s) => s.classList.remove("selected"));
    sw.classList.add("selected");
  });
});

// ---------- freehand drawing ----------
let strokeActive = false;
let lastX = 0;
let lastY = 0;

function pointerPos(e) {
  const dpr = window.devicePixelRatio || 1;
  return [e.clientX * dpr, e.clientY * dpr];
}

function strokeSegment(x0, y0, x1, y1) {
  const dpr = window.devicePixelRatio || 1;
  const size = parseFloat(brushSizeSlider.value) * dpr;
  const hardness = parseFloat(brushHardnessSlider.value) / 100;

  dctx.save();
  dctx.lineCap = "round";
  dctx.lineJoin = "round";

  if (activeTool === "erase") {
    dctx.globalCompositeOperation = "destination-out";
    dctx.globalAlpha = 1;
    dctx.lineWidth = size;
  } else {
    dctx.globalCompositeOperation = "source-over";
    dctx.strokeStyle = selectedColor;
    dctx.shadowColor = selectedColor;
    dctx.shadowBlur = (1 - hardness) * size * 0.7;
    dctx.globalAlpha = 0.55 + hardness * 0.45;
    dctx.lineWidth = size * (0.45 + hardness * 0.55);
  }

  dctx.beginPath();
  dctx.moveTo(x0, y0);
  dctx.lineTo(x1, y1);
  dctx.stroke();
  dctx.restore();
}

drawCanvas.addEventListener("pointerdown", (e) => {
  if (activeTool !== "draw" && activeTool !== "erase") return;
  strokeActive = true;
  drawCanvas.setPointerCapture(e.pointerId);
  [lastX, lastY] = pointerPos(e);
  strokeSegment(lastX, lastY, lastX, lastY);
});

drawCanvas.addEventListener("pointermove", (e) => {
  if (!strokeActive) return;
  const [x, y] = pointerPos(e);
  strokeSegment(lastX, lastY, x, y);
  lastX = x;
  lastY = y;
});

drawCanvas.addEventListener("pointerup", (e) => {
  strokeActive = false;
  try {
    drawCanvas.releasePointerCapture(e.pointerId);
  } catch (_) {}
});

// ---------- draggable, borderless text boxes ----------
function makeTextBoxDraggable(el, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    el.style.left = `${e.clientX - offsetX}px`;
    el.style.top = `${e.clientY - offsetY}px`;
  });
  handle.addEventListener("pointerup", (e) => {
    dragging = false;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch (_) {}
  });
}

function createTextBox(x, y) {
  const el = document.createElement("div");
  el.className = "text-box";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  const content = document.createElement("div");
  content.className = "text-content";
  content.contentEditable = "true";
  content.spellcheck = false;
  content.style.color = selectedColor;
  el.appendChild(content);

  const handle = document.createElement("div");
  handle.className = "drag-handle";
  el.appendChild(handle);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.title = "Remove";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.remove();
  });
  el.appendChild(removeBtn);

  makeTextBoxDraggable(el, handle);
  textLayer.appendChild(el);
  content.focus();
  return el;
}

textLayer.addEventListener("click", (e) => {
  if (activeTool !== "text") return;
  if (e.target !== textLayer) return;
  createTextBox(e.clientX, e.clientY);
});

resizeCanvas();
showTaskbar();
showGifDock();
showRightDock();
