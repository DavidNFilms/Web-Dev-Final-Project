
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const QUALITIES = [
  { name: "maj", intervals: [0, 4, 7] },
  { name: "min", intervals: [0, 3, 7] },
  { name: "dim", intervals: [0, 3, 6] },
  { name: "aug", intervals: [0, 4, 8] },
  { name: "7", intervals: [0, 4, 7, 10] },
  { name: "m7", intervals: [0, 3, 7, 10] },
  { name: "maj7", intervals: [0, 4, 7, 11] },
  { name: "sus2", intervals: [0, 2, 7] },
  { name: "sus4", intervals: [0, 5, 7] },
];

let video;
let handpose;
let predictions = [];
let selectedRootIndex = 0;
let selectedQualityIndex = 0;

const MIRROR_VIDEO = true;
const VIDEO_W = 640;
const VIDEO_H = 480;
const DONUT_X_OFFSET = 190;
const DONUT_SCALE = 0.19;
const DONUT_BOTTOM_OFFSET = 14;
const DONUT_LABEL_H = 32;
const DONUT_LABEL_GAP = 12; 

function preload() {
  handpose = ml5.handPose({
    maxHands: 2,
    runtime: "mediapipe",
    modelType: "full",
    solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/hands",
  });
}

function setup() {
  pixelDensity(1);
  const c = createCanvas(windowWidth, windowHeight);
  c.position(0, 0);
  c.style("display", "block");
  c.style("position", "fixed");
  c.style("inset", "0");

  video = createCapture(VIDEO, () => {});
  video.size(VIDEO_W, VIDEO_H);
  video.hide();

  handpose.detectStart(video, (results) => {
    predictions = results || [];
  });

  

  textFont("ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial");
}


function draw() {
  background(0);
  const rect = getVideoCoverRect();
  const info = updateChordFromHands(predictions, rect);
  drawVideoLayer(rect);
  for (let i = 0; i < Math.min(2, predictions.length); i++) {
    drawHand(predictions[i], rect, i);
  }
  drawHUD(info);
}

function updateChordFromHands(hands, rect) {
  const donuts = getDonutLayout();
  const normalized = (Array.isArray(hands) ? hands : [])
    .map((h) => ({ hand: h, points: getHandPoints(h) }))
    .filter((h) => Array.isArray(h.points) && h.points.length >= 13)
    .slice(0, 2)
    .map(({ hand, points }) => {
      const wrist = landmarkToScreen(points[0], rect);
      const indexTip = landmarkToScreen(points[8], rect);
      const middleTip = landmarkToScreen(points[12], rect);
      return { wrist, indexTip, middleTip };
    });

  if (normalized.length === 0) return buildChordInfo(null, null);

  let rootPointer = null;
  let qualityPointer = null;

  if (normalized.length === 1) {
    rootPointer = normalized[0].indexTip;
    qualityPointer = normalized[0].middleTip;
  } else {
    const sorted = normalized.slice().sort((a, b) => a.wrist.x - b.wrist.x);
    rootPointer = sorted[0].indexTip;
    qualityPointer = sorted[1].indexTip;
  }

  const maybeRoot = pickFromDonut(rootPointer, donuts.notes, NOTE_NAMES.length);
  if (maybeRoot !== null) selectedRootIndex = maybeRoot;
  const maybeQuality = pickFromDonut(qualityPointer, donuts.qualities, QUALITIES.length);
  if (maybeQuality !== null) selectedQualityIndex = maybeQuality;

  return buildChordInfo(rootPointer, qualityPointer);
}

function buildChordInfo(rootPointer, qualityPointer) {
  const root = NOTE_NAMES[selectedRootIndex];
  const quality = QUALITIES[selectedQualityIndex];
  const tones = quality.intervals.map((s) => NOTE_NAMES[(selectedRootIndex + s) % 12]);
  return { root, quality: quality.name, tones, rootPointer, qualityPointer };
}


function getVideoCoverRect() {
  const canvasAspect = width / height;
  const videoAspect = VIDEO_W / VIDEO_H;
  let w, h, x, y;
  if (canvasAspect > videoAspect) {
    w = width;
    h = width / videoAspect;
  } else {
    h = height;
    w = height * videoAspect;
  }
  x = (width - w) / 2;
  y = (height - h) / 2;
  return { x, y, w, h };
}

function drawVideoLayer(rect) {
  push();
  if (MIRROR_VIDEO) {
    translate(rect.x + rect.w, rect.y);
    scale(-1, 1);
  } else {
    translate(rect.x, rect.y);
  }
  image(video, 0, 0, rect.w, rect.h);
  pop();
}

function getHandPoints(hand) {
  if (!hand) return [];
  if (Array.isArray(hand.keypoints)) return hand.keypoints;
  if (Array.isArray(hand.landmarks)) return hand.landmarks;
  return [];
}

function landmarkToScreen(point, rect) {
  let sx = (point.x / VIDEO_W) * rect.w;
  let sy = (point.y / VIDEO_H) * rect.h;
  if (MIRROR_VIDEO) sx = rect.w - sx;
  return { x: rect.x + sx, y: rect.y + sy };
}

function drawHand(prediction, rect, handIndex) {
  const pts = getHandPoints(prediction);
  if (!pts || pts.length === 0) return;

  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
    [0, 5], [5, 6], [6, 7], [7, 8],           // index
    [5, 9], [9, 10], [10, 11], [11, 12],       // middle
    [9, 13], [13, 14], [14, 15], [15, 16],     // ring
    [13, 17], [17, 18], [18, 19], [19, 20],    // pinky
    [0, 17],                                    // palm
  ];

  const COLORS = [
    [0, 255, 200],
    [255, 200, 0],
  ];
  const col = COLORS[handIndex % 2];

  
  stroke(col[0], col[1], col[2], 160);
  strokeWeight(2);
  for (const [a, b] of CONNECTIONS) {
    if (pts[a] && pts[b]) {
      const pa = landmarkToScreen(pts[a], rect);
      const pb = landmarkToScreen(pts[b], rect);
      line(pa.x, pa.y, pb.x, pb.y);
    }
  }

  
  noStroke();
  fill(col[0], col[1], col[2]);
  for (let i = 0; i < pts.length; i++) {
    const p = landmarkToScreen(pts[i], rect);
    circle(p.x, p.y, 8);
  }
}


function getDonutLayout() {
  const r = min(width, height) * DONUT_SCALE;
  const safeXOffset = min(DONUT_X_OFFSET, max(0, width / 2 - r - 18));
  const cy = height - r - DONUT_LABEL_H - DONUT_LABEL_GAP - DONUT_BOTTOM_OFFSET;
  return {
    notes: { cx: width / 2 - safeXOffset, cy, r },
    qualities: { cx: width / 2 + safeXOffset, cy, r },
  };
}


function pickFromDonut(pointer, donut, count) {
  if (!pointer) return null;
  const dx = pointer.x - donut.cx;
  const dy = pointer.y - donut.cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  const innerR = donut.r * 0.35;
  if (d < innerR || d > donut.r) return null;
  let angle = Math.atan2(dy, dx) + HALF_PI;
  if (angle < 0) angle += TWO_PI;
  return Math.floor((angle / TWO_PI) * count) % count;
}


function drawDonut(donut, labels, selectedIndex, pointer) {
  const count = labels.length;
  const innerR = donut.r * 0.35;
  const sliceAngle = TWO_PI / count;

  for (let i = 0; i < count; i++) {
    const a0 = -HALF_PI + i * sliceAngle;
    const a1 = a0 + sliceAngle;
    fill(i === selectedIndex ? color(80, 200, 255, 200) : color(40, 45, 60, 180));
    stroke(0, 0, 0, 100);
    strokeWeight(1);
    arc(donut.cx, donut.cy, donut.r * 2, donut.r * 2, a0, a1, PIE);
  }

  
  noStroke();
  fill(0);
  circle(donut.cx, donut.cy, innerR * 2);

  
  fill(255);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(12);
  const labelR = (innerR + donut.r) / 2;
  for (let i = 0; i < count; i++) {
    const mid = -HALF_PI + (i + 0.5) * sliceAngle;
    text(labels[i], donut.cx + cos(mid) * labelR, donut.cy + sin(mid) * labelR);
  }


  if (pointer) {
    fill(255, 80, 80);
    noStroke();
    circle(pointer.x, pointer.y, 12);
  }
}


function drawDonutCharts(info) {
  const donuts = getDonutLayout();
  drawDonut(donuts.notes, NOTE_NAMES, selectedRootIndex, info.rootPointer);
  drawDonut(
    donuts.qualities,
    QUALITIES.map((q) => q.name),
    selectedQualityIndex,
    info.qualityPointer
  );

  drawUnderDonutLabel(donuts.notes, NOTE_NAMES[selectedRootIndex]);
  drawUnderDonutLabel(donuts.qualities, QUALITIES[selectedQualityIndex].name);
}

function drawUnderDonutLabel(donut, textValue) {
  const w = donut.r * 1.55;
  const h = DONUT_LABEL_H;
  const x = donut.cx;
  const y = donut.cy + donut.r + DONUT_LABEL_GAP + h / 2;

  noStroke();
  fill(0, 0, 0, 160);
  rectMode(CENTER);
  rect(x, y, w, h, 12);

  fill(255);
  textAlign(CENTER, CENTER);
  textSize(16);
  text(textValue, x, y + 1);

  rectMode(CORNER);
  textAlign(LEFT, TOP);
}


function drawHUD(info) {
  drawDonutCharts(info);

  noStroke();
  fill(0, 0, 0, 140);
  rectMode(CORNER);
  rect(14, 14, 360, 68, 14);

  fill(255);
  textAlign(LEFT, TOP);
  textSize(20);
  text(`${info.root}${info.quality}`, 28, 22);

  textSize(13);
  fill(210);
  text(`tones: ${info.tones.join("  ")}`, 28, 50);
}


function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
