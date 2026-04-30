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

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

let video;
let handpose;
let rawHands = [];
let trackedHands = [];

let selectedRootIndex = 0;
let selectedQualityIndex = 0;

let synth;
let playingChord = null;
let audioReady = false;
let playbackEnabled = false;
let heldChordKey = "";
let heldNotes = [];
let queuedChordKey = "";
let queuedChordAt = -1000;
let lastChordChangeAt = -1000;

// p5 DOM elements
let playButton;
let statusDiv;

let lastTouchToggleAt = -1000;
let lastPredictionMillis = -1000;

let handColors = [];
let activeSliceColor;
let idleSliceColor;
let hudPanelColor;
let dimTextColor;
let donutHoleColor;
let pointerColor;

const BASE_OCTAVE = 4;

const MIRROR_VIDEO = true;
const VIDEO_W = 640;
const VIDEO_H = 480;
const DONUT_X_OFFSET = 190;
const DONUT_SCALE = 0.19;
const DONUT_BOTTOM_OFFSET = 14;
const DONUT_LABEL_H = 32;
const DONUT_LABEL_GAP = 12;
const HAND_CONFIDENCE_MIN = 0.75;
const PREDICTION_STALE_MS = 220;
const CHORD_STABLE_MS = 90;
const CHORD_CHANGE_COOLDOWN_MS = 120;

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

  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.position(0, 0);
  canvas.style("display", "block");
  canvas.style("position", "fixed");
  canvas.style("inset", "0");

  video = createCapture(VIDEO);
  video.size(VIDEO_W, VIDEO_H);
  video.hide();

  synth = new p5.PolySynth();
  if (typeof synth.setADSR === "function") synth.setADSR(0.02, 0.08, 0.55, 0.25);
  if (typeof synth.amp === "function") synth.amp(0.05);

  handColors = [
    color(0, 255, 200),
    color(255, 200, 0),
  ];
  activeSliceColor = color(28, 110, 140, 180);
  idleSliceColor = color(96, 88, 86, 180);
  hudPanelColor = color(39, 65, 86, 180);
  dimTextColor = color(208, 204, 208);
  donutHoleColor = color(39, 65, 86);
  pointerColor = color(255, 80, 80);

  textFont("ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial");

  handpose.detectStart(video, gotHands);

  playButton = createButton('Play');
  playButton.position(24, 92);
  playButton.style('padding', '8px 12px');
  playButton.style('border-radius', '8px');
  playButton.mousePressed(() => {
    if (millis() - lastTouchToggleAt < 200) return;
    lastTouchToggleAt = millis();
    togglePlayback();
  });

  statusDiv = createDiv('Ready');
  statusDiv.position(24, 130);
  statusDiv.style('color', '#ddd');
  statusDiv.style('font-family', 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial');
  statusDiv.style('font-size', '13px');
}

function updateUI(info) {
  if (playButton) {
    playButton.html(playbackEnabled ? 'Pause' : 'Play');
  }

  if (statusDiv) {
    let txt = '';
    if (!audioReady) txt = 'Audio locked — tap Play to enable sound';
    else txt = playbackEnabled ? 'Audio: playing' : 'Audio: paused';

    if (info && info.root && info.quality) {
      txt += ' | Chord: ' + info.root + info.quality;
    }

    statusDiv.html(txt);
  }
}

function gotHands(results) {
  if (Array.isArray(results)) {
    rawHands = results;
  } else {
    rawHands = [];
  }
  lastPredictionMillis = millis();
}

function draw() {
  background(0);

  const rect = getVideoCoverRect();
  updateTrackedHands(rect);

  const info = updateChordFromHands();

  drawVideoLayer(rect);
  drawTrackedHands();
  drawHUD(info);
  syncSustainedChord(info);
  updateUI(info);
}

function updateTrackedHands(rect) {
  trackedHands = [];

  if (millis() - lastPredictionMillis > PREDICTION_STALE_MS) {
    rawHands = [];
    return;
  }

  for (let i = 0; i < rawHands.length; i++) {
    if (trackedHands.length >= 2) break;

    const rawHand = rawHands[i];
    const points = getHandPoints(rawHand);

    if (points.length < 13) continue;
    if (getHandConfidence(rawHand) < HAND_CONFIDENCE_MIN) continue;

    const trackedHand = buildTrackedHand(points, rect);
    if (!handIsInFrame(trackedHand, rect)) continue;

    trackedHands.push(trackedHand);
  }
}

function buildTrackedHand(points, rect) {
  const screenPoints = [];

  for (let i = 0; i < points.length; i++) {
    screenPoints.push(landmarkToScreen(points[i], rect));
  }

  return {
    points: screenPoints,
    wrist: screenPoints[0],
    indexTip: screenPoints[8],
    middleTip: screenPoints[12],
  };
}

function updateChordFromHands() {
  const donuts = getDonutLayout();

  if (trackedHands.length === 0) {
    return buildChordInfo(null, null, false, false);
  }

  let rootPointer = null;
  let qualityPointer = null;

  if (trackedHands.length === 1) {
    rootPointer = trackedHands[0].indexTip;
    qualityPointer = trackedHands[0].middleTip;
  } else {
    let leftHand = trackedHands[0];
    let rightHand = trackedHands[1];

    if (leftHand.wrist.x > rightHand.wrist.x) {
      const temp = leftHand;
      leftHand = rightHand;
      rightHand = temp;
    }

    rootPointer = leftHand.indexTip;
    qualityPointer = rightHand.indexTip;
  }

  const rootIndex = pickFromDonut(rootPointer, donuts.notes, NOTE_NAMES.length);
  const qualityIndex = pickFromDonut(qualityPointer, donuts.qualities, QUALITIES.length);

  if (rootIndex !== -1) selectedRootIndex = rootIndex;
  if (qualityIndex !== -1) selectedQualityIndex = qualityIndex;

  return buildChordInfo(rootPointer, qualityPointer, rootIndex !== -1, qualityIndex !== -1);
}

function buildChordInfo(rootPointer, qualityPointer, rootActive, qualityActive) {
  const quality = QUALITIES[selectedQualityIndex];
  const tones = [];

  for (let i = 0; i < quality.intervals.length; i++) {
    const interval = quality.intervals[i];
    const noteIndex = (selectedRootIndex + interval) % NOTE_NAMES.length;
    tones.push(NOTE_NAMES[noteIndex]);
  }

  return {
    root: NOTE_NAMES[selectedRootIndex],
    quality: quality.name,
    tones: tones,
    rootPointer: rootPointer,
    qualityPointer: qualityPointer,
    rootActive: rootActive,
    qualityActive: qualityActive,
  };
}

function getVideoCoverRect() {
  const canvasAspect = width / height;
  const videoAspect = VIDEO_W / VIDEO_H;

  let w = 0;
  let h = 0;

  if (canvasAspect > videoAspect) {
    w = width;
    h = width / videoAspect;
  } else {
    h = height;
    w = height * videoAspect;
  }

  const x = (width - w) / 2;
  const y = (height - h) / 2;

  return {
    pos: createVector(x, y),
    size: createVector(w, h),
  };
}

function drawVideoLayer(rect) {
  push();

  if (MIRROR_VIDEO) {
    translate(rect.pos.x + rect.size.x, rect.pos.y);
    scale(-1, 1);
  } else {
    translate(rect.pos.x, rect.pos.y);
  }

  image(video, 0, 0, rect.size.x, rect.size.y);
  pop();
}

function getHandPoints(hand) {
  if (!hand) return [];
  if (Array.isArray(hand.keypoints)) return hand.keypoints;
  if (Array.isArray(hand.landmarks)) return hand.landmarks;
  return [];
}

function getHandConfidence(hand) {
  if (!hand) return 0;
  if (typeof hand.handInViewConfidence === "number") return hand.handInViewConfidence;
  if (typeof hand.score === "number") return hand.score;
  if (hand.handedness && typeof hand.handedness.score === "number") return hand.handedness.score;
  return 1;
}

function pointInRect(point, rect) {
  if (!point) return false;

  return (
    point.x >= rect.pos.x &&
    point.x <= rect.pos.x + rect.size.x &&
    point.y >= rect.pos.y &&
    point.y <= rect.pos.y + rect.size.y
  );
}

function handIsInFrame(hand, rect) {
  return (
    pointInRect(hand.wrist, rect) &&
    pointInRect(hand.indexTip, rect) &&
    pointInRect(hand.middleTip, rect)
  );
}

function landmarkToScreen(point, rect) {
  let sx = map(point.x, 0, VIDEO_W, 0, rect.size.x);
  const sy = map(point.y, 0, VIDEO_H, 0, rect.size.y);

  if (MIRROR_VIDEO) {
    sx = rect.size.x - sx;
  }

  return createVector(rect.pos.x + sx, rect.pos.y + sy);
}

function drawTrackedHands() {
  for (let i = 0; i < trackedHands.length; i++) {
    drawTrackedHand(trackedHands[i], i);
  }
}

function drawTrackedHand(hand, handIndex) {
  const points = hand.points;
  const handColor = handColors[handIndex % handColors.length];

  stroke(handColor);
  strokeWeight(2);

  for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
    const a = HAND_CONNECTIONS[i][0];
    const b = HAND_CONNECTIONS[i][1];
    const pa = points[a];
    const pb = points[b];

    if (!pa || !pb) continue;
    line(pa.x, pa.y, pb.x, pb.y);
  }

  noStroke();
  fill(handColor);

  for (let i = 0; i < points.length; i++) {
    circle(points[i].x, points[i].y, 8);
  }
}

function getDonutLayout() {
  const r = min(width, height) * DONUT_SCALE;
  const safeXOffset = min(DONUT_X_OFFSET, max(0, width / 2 - r - 18));
  const cy = height - r - DONUT_LABEL_H - DONUT_LABEL_GAP - DONUT_BOTTOM_OFFSET;

  return {
    notes: { center: createVector(width / 2 - safeXOffset, cy), radius: r },
    qualities: { center: createVector(width / 2 + safeXOffset, cy), radius: r },
  };
}

function pickFromDonut(pointer, donut, count) {
  if (!pointer) return -1;

  const d = p5.Vector.dist(pointer, donut.center);
  const innerR = donut.radius * 0.35;

  if (d < innerR || d > donut.radius) return -1;

  let angle = p5.Vector.sub(pointer, donut.center).heading() + HALF_PI;
  if (angle < 0) angle += TWO_PI;

  return floor((angle / TWO_PI) * count) % count;
}

function drawDonut(donut, labels, selectedIndex, pointer) {
  const count = labels.length;
  const innerR = donut.radius * 0.35;
  const sliceAngle = TWO_PI / count;

  for (let i = 0; i < count; i++) {
    const startAngle = -HALF_PI + i * sliceAngle;
    const endAngle = startAngle + sliceAngle;

    fill(i === selectedIndex ? activeSliceColor : idleSliceColor);

    stroke(0, 0, 0, 100);
    strokeWeight(1);
    arc(donut.center.x, donut.center.y, donut.radius * 2, donut.radius * 2, startAngle, endAngle, PIE);
  }

  noStroke();
  fill(donutHoleColor);
  circle(donut.center.x, donut.center.y, innerR * 2);

  fill(255);
  textAlign(CENTER, CENTER);
  textSize(12);

  const labelRadius = (innerR + donut.radius) / 2;

  for (let i = 0; i < count; i++) {
    const midAngle = -HALF_PI + (i + 0.5) * sliceAngle;
    const labelPos = p5.Vector.fromAngle(midAngle).mult(labelRadius).add(donut.center);
    text(labels[i], labelPos.x, labelPos.y);
  }

  if (pointer) {
    fill(pointerColor);
    circle(pointer.x, pointer.y, 12);
  }
}

function drawDonutCharts(info) {
  const donuts = getDonutLayout();
  const qualityLabels = [];

  for (let i = 0; i < QUALITIES.length; i++) {
    qualityLabels.push(QUALITIES[i].name);
  }

  drawDonut(donuts.notes, NOTE_NAMES, selectedRootIndex, info.rootPointer);
  drawDonut(donuts.qualities, qualityLabels, selectedQualityIndex, info.qualityPointer);

  drawUnderDonutLabel(donuts.notes, NOTE_NAMES[selectedRootIndex]);
  drawUnderDonutLabel(donuts.qualities, QUALITIES[selectedQualityIndex].name);
}

function drawUnderDonutLabel(donut, labelText) {
  const w = donut.radius * 1.55;
  const h = DONUT_LABEL_H;
  const x = donut.center.x;
  const y = donut.center.y + donut.radius + DONUT_LABEL_GAP + h / 2;

  noStroke();
  fill(39, 65, 86);
  rectMode(CENTER);
  rect(x, y, w, h, 12);

  fill(255);
  textAlign(CENTER, CENTER);
  textSize(16);
  text(labelText, x, y + 1);

  rectMode(CORNER);
  textAlign(LEFT, TOP);
}

function drawHUD(info) {
  drawDonutCharts(info);

  noStroke();
  fill(hudPanelColor);
  rect(14, 14, 360, 68, 5);

  let displayRoot = info.root;
  let displayQuality = info.quality;
  let displayTones = info.tones;

  if (playingChord) {
    displayRoot = playingChord.rootNote;
    displayQuality = playingChord.quality;
    displayTones = playingChord.tones;
  }

  fill(255);
  textAlign(LEFT, TOP);
  textSize(20);
  text(displayRoot + displayQuality, 28, 22);

  textSize(13);
  fill(dimTextColor);
  text("tones: " + displayTones.join(" "), 28, 50);
}

function getChordNoteStrings(rootIndex, qualityIndex) {
  const tones = [];
  const intervals = QUALITIES[qualityIndex].intervals;

  for (let i = 0; i < intervals.length; i++) {
    const absolute = rootIndex + intervals[i];
    const pitchClass = ((absolute % 12) + 12) % 12;
    const octaveShift = floor(absolute / 12);
    tones.push(NOTE_NAMES[pitchClass] + (BASE_OCTAVE + octaveShift));
  }

  return tones;
}

function releaseHeldChord() {
  if (synth && typeof synth.noteRelease === "function" && heldNotes.length > 0) {
    for (let i = 0; i < heldNotes.length; i++) {
      synth.noteRelease(heldNotes[i], 0);
    }
  }

  heldNotes = [];
  heldChordKey = "";
  playingChord = null;
}

function syncSustainedChord(info) {
  if (!synth || !audioReady || !playbackEnabled) {
    queuedChordKey = "";
    releaseHeldChord();
    return;
  }

  if (!info.rootActive || !info.qualityActive) {
    queuedChordKey = "";
    releaseHeldChord();
    return;
  }

  const chordKey = selectedRootIndex + ":" + selectedQualityIndex;
  if (chordKey === heldChordKey) {
    queuedChordKey = "";
    return;
  }

  if (chordKey !== queuedChordKey) {
    queuedChordKey = chordKey;
    queuedChordAt = millis();
    return;
  }

  if (millis() - queuedChordAt < CHORD_STABLE_MS) return;
  if (millis() - lastChordChangeAt < CHORD_CHANGE_COOLDOWN_MS) return;

  releaseHeldChord();

  const tones = getChordNoteStrings(selectedRootIndex, selectedQualityIndex);
  const baseVelocity = random(0.45, 0.75);

  if (typeof synth.noteAttack === "function") {
    for (let i = 0; i < tones.length; i++) {
      const velocity = max(0.1, baseVelocity - i * 0.06);
      synth.noteAttack(tones[i], velocity, 0);
    }
  } else {
    for (let i = 0; i < tones.length; i++) {
      synth.play(tones[i], baseVelocity, 0, 0.9);
    }
  }

  heldNotes = tones;
  heldChordKey = chordKey;
  queuedChordKey = "";
  lastChordChangeAt = millis();
  playingChord = {
    rootNote: tones[0],
    quality: QUALITIES[selectedQualityIndex].name,
    tones: tones,
  };
}

function unlockAudio() {
  userStartAudio();
  audioReady = true;
}

function togglePlayback() {
  unlockAudio();
  playbackEnabled = !playbackEnabled;

  if (!playbackEnabled) {
    releaseHeldChord();
  }
  updateUI();
}

function mousePressed() {
  if (millis() - lastTouchToggleAt < 400) return;
  togglePlayback();
}

function touchStarted() {
  lastTouchToggleAt = millis();
  togglePlayback();
  return false;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
