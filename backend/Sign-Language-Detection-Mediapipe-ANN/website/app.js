import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";

// ============================================
// DOM Elements
// ============================================
const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay-canvas");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("start-btn");
const clearBtn = document.getElementById("clear-btn");
const undoBtn = document.getElementById("undo-btn");
const translateBtn = document.getElementById("translate-btn");
const predictionBadge = document.getElementById("prediction-badge");
const predictionLabel = document.getElementById("prediction-label");
const predictionConfidence = document.getElementById("prediction-confidence");
const sequenceDisplay = document.getElementById("sequence-display");
const sentenceDisplay = document.getElementById("sentence-display");
const supportedSigns = document.getElementById("supported-signs");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const saveBtn = document.getElementById("save-btn");

// ============================================
// State (mirrors your Python variables)
// ============================================
let handLandmarker = null;
let onnxSession = null;
let classes = [];
let isRunning = false;
let animationId = null;

// Debouncing state — same as your Python: 15 consecutive frames
let sequence = [];
let currentWord = "";
let consecutiveFrames = 0;
const REQUIRED_FRAMES = 30; // Increased to 30 for better stability, adjust as needed
const CONFIDENCE_THRESHOLD = 60;

let isTranslating = false;

// Hand connections — same as your HAND_CONNECTIONS in Python
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [9, 10], [10, 11], [11, 12],
    [13, 14], [14, 15], [15, 16],
    [17, 18], [18, 19], [19, 20],
    [0, 17], [5, 9], [9, 13], [13, 17],
];

// ============================================
// 1. Load Models
// ============================================
async function loadModels() {
    try {
        // Load classes.json
        loadingText.textContent = "Loading class labels...";
        const res = await fetch("./classes.json");
        classes = await res.json();

        // Render supported signs
        supportedSigns.innerHTML = classes
            .map((c) => `<span class="sign-tag">${c}</span>`)
            .join("");

        // Load MediaPipe Hand Landmarker
        loadingText.textContent = "Loading MediaPipe Hand Landmarker...";
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
        );

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
                delegate: "GPU",
            },
            numHands: 2,
            runningMode: "VIDEO",
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
        });

        // Load ONNX model
        loadingText.textContent = "Loading sign language model...";
        ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
        onnxSession = await ort.InferenceSession.create("./sign_model.onnx");

        // Ready
        loadingOverlay.classList.add("hidden");
        startBtn.disabled = false;
        startBtn.textContent = "Start Camera";
        translateBtn.disabled = false;
    } catch (err) {
        console.error("Failed to load models:", err);
        loadingText.textContent = `Error: ${err.message}. Check console (F12).`;
    }
}

// ============================================
// 2. Webcam
// ============================================
async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
    });
    video.srcObject = stream;
    await new Promise((resolve) => (video.onloadedmetadata = resolve));
    video.play();

    // Match canvas to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
}

function stopCamera() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
    }
}

// ============================================
// 3. Drawing (mirrors draw_custom_landmarks)
// ============================================
function drawLandmarks(landmarks) {
    const w = canvas.width;
    const h = canvas.height;

    // Because the video is mirrored via CSS scaleX(-1),
    // we mirror the canvas drawing to match.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);

    for (const hand of landmarks) {
        // Draw connections
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        for (const [i1, i2] of HAND_CONNECTIONS) {
            if (i1 < hand.length && i2 < hand.length) {
                const a = hand[i1];
                const b = hand[i2];
                ctx.beginPath();
                ctx.moveTo(a.x * w, a.y * h);
                ctx.lineTo(b.x * w, b.y * h);
                ctx.stroke();
            }
        }

        // Draw points
        ctx.fillStyle = "#ff3333";
        for (const lm of hand) {
            ctx.beginPath();
            ctx.arc(lm.x * w, lm.y * h, 4, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    ctx.restore();
}

// ============================================
// 4. Inference (mirrors your webcam loop)
// ============================================

// Softmax — same as torch.nn.functional.softmax
function softmax(arr) {
    const max = Math.max(...arr);
    const exps = arr.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((v) => v / sum);
}

async function classify(handFeatures) {
    const tensor = new ort.Tensor("float32", Float32Array.from(handFeatures), [1, 126]);
    const results = await onnxSession.run({ input: tensor });
    const output = Array.from(results.output.data);

    const probs = softmax(output);
    let maxIdx = 0;
    for (let i = 1; i < probs.length; i++) {
        if (probs[i] > probs[maxIdx]) maxIdx = i;
    }

    return {
        label: classes[maxIdx],
        confidence: probs[maxIdx] * 100,
    };
}

// ============================================
// 5. Main Loop
// ============================================
async function processFrame() {
    if (!isRunning) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = performance.now();
    const result = handLandmarker.detectForVideo(video, now);

    // Build 126-element feature vector — same as your Python code
    const handFeatures = new Float32Array(126);

    if (result.landmarks && result.landmarks.length > 0) {
        drawLandmarks(result.landmarks);

        for (let i = 0; i < Math.min(result.landmarks.length, 2); i++) {
            const hand = result.landmarks[i];
            const startIdx = i * 63;
            for (let j = 0; j < 21; j++) {
                handFeatures[startIdx + j * 3] = hand[j].x;
                handFeatures[startIdx + j * 3 + 1] = hand[j].y;
                handFeatures[startIdx + j * 3 + 2] = hand[j].z;
            }
        }

        const prediction = await classify(handFeatures);

        if (prediction.confidence > CONFIDENCE_THRESHOLD) {
            // Show badge
            predictionBadge.classList.remove("hidden");
            predictionLabel.textContent = prediction.label;
            predictionConfidence.textContent = `${prediction.confidence.toFixed(1)}%`;

            // Debouncing logic — mirrors your Python 15-frame check
            if (prediction.label === currentWord) {
                consecutiveFrames++;
            } else {
                currentWord = prediction.label;
                consecutiveFrames = 1;
            }

            if (consecutiveFrames === REQUIRED_FRAMES) {
                if (sequence.length === 0 || sequence[sequence.length - 1] !== currentWord) {
                    sequence.push(currentWord);
                    updateUI();
                }
            }
        } else {
            predictionBadge.classList.add("hidden");
        }
    } else {
        predictionBadge.classList.add("hidden");
    }

    animationId = requestAnimationFrame(processFrame);
}

// ============================================
// 6. UI Updates
// ============================================
function updateUI() {
    if (sequence.length === 0) {
        sequenceDisplay.textContent = "Waiting for signs...";
        sentenceDisplay.textContent = 'Press "Translate" to form a sentence.';
        saveBtn.disabled = true;  // ← disable save when cleared
    } else {
        sequenceDisplay.textContent = sequence.map((s) => s.toUpperCase()).join("  \u2192  ");
    }
}

// ============================================
// 6b. Gemini Translation
// ============================================
async function translateWithGemini() {
    if (sequence.length === 0 || isTranslating) return;

    isTranslating = true;
    translateBtn.disabled = true;
    translateBtn.classList.add("translating");
    translateBtn.textContent = "Translating...";
    sentenceDisplay.textContent = "Translating...";
    saveBtn.disabled = true;  // ← disable save while translating

    const words = sequence.join(" ");

    try {
        const response = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ words }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data?.error || `Server returned ${response.status}`);
        }

        sentenceDisplay.textContent = data.sentence || "No response";
        saveBtn.disabled = false;  // ← enable save only after successful translation
    } catch (e) {
        console.error("Translation error:", e);
        sentenceDisplay.textContent = `Error: ${e.message}`;
        saveBtn.disabled = true;  // ← keep disabled on error
    } finally {
        isTranslating = false;
        translateBtn.disabled = false;
        translateBtn.classList.remove("translating");
        translateBtn.textContent = "Translate";
    }
}

// ============================================
// 6c. Save Session
// ============================================
async function saveSession() {
    const transcript = sentenceDisplay.textContent;
    if (!transcript || transcript === 'Press "Translate" to form a sentence.') return;

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
        await fetch("http://localhost:8000/api/sessions/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode:       "sign",
                transcript: transcript,
                status:     "done",
            }),
        });
        saveBtn.textContent = "Saved ✓";
    } catch (e) {
        console.error("Save failed:", e);
        saveBtn.textContent = "Save Failed";
    } finally {
        setTimeout(() => {
            saveBtn.textContent = "Save Session";
            saveBtn.disabled = false;
        }, 2000);
    }
}

// ============================================
// 7. Event Listeners
// ============================================
startBtn.addEventListener("click", async () => {
    if (!isRunning) {
        await startCamera();
        isRunning = true;
        startBtn.textContent = "Stop Camera";
        startBtn.classList.add("running");
        processFrame();
    } else {
        isRunning = false;
        cancelAnimationFrame(animationId);
        stopCamera();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        predictionBadge.classList.add("hidden");
        startBtn.textContent = "Start Camera";
        startBtn.classList.remove("running");
    }
});

clearBtn.addEventListener("click", () => {
    sequence = [];
    currentWord = "";
    consecutiveFrames = 0;
    saveBtn.disabled = true;  // ← reset save button on clear
    updateUI();
});

undoBtn.addEventListener("click", () => {
    if (sequence.length > 0) {
        sequence.pop();
        updateUI();
    }
});

translateBtn.addEventListener("click", () => {
    translateWithGemini();
});

saveBtn.addEventListener("click", () => {
    saveSession();
});

// Keyboard shortcuts — same as your Python: C to clear, Enter to translate
document.addEventListener("keydown", (e) => {
    if (document.activeElement.tagName === "INPUT") return;

    if (e.key === "c" || e.key === "C") {
        clearBtn.click();
    }
    if (e.key === "Backspace") {
        undoBtn.click();
    }
    if (e.key === "Enter") {
        translateBtn.click();
    }
});

// ============================================
// 8. Initialize
// ============================================
saveBtn.disabled = true;  // ← disabled on page load until translation succeeds
loadModels();