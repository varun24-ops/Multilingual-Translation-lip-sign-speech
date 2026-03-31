# backend/sign_language/sign_infer.py
import cv2
import torch
import torch.nn as nn
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import warnings
import os

warnings.filterwarnings('ignore')

# ── paths (relative to this file) ──────────────────────────────────────────
BASE = os.path.dirname(os.path.abspath(__file__))

# ── Neural Network (same architecture as sentence.py) ──────────────────────
class SignLanguageNN(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.fc1 = nn.Linear(126, 256)
        self.relu1 = nn.ReLU()
        self.dropout1 = nn.Dropout(0.2)
        self.fc2 = nn.Linear(256, 128)
        self.relu2 = nn.ReLU()
        self.dropout2 = nn.Dropout(0.2)
        self.fc3 = nn.Linear(128, num_classes)

    def forward(self, x):
        x = self.relu1(self.fc1(x))
        x = self.dropout1(x)
        x = self.relu2(self.fc2(x))
        x = self.dropout2(x)
        return self.fc3(x)


# ── Load models once at import time (not per request) ──────────────────────
print("[sign] Loading PyTorch sign model...")
classes   = np.load(os.path.join(BASE, 'classes.npy'), allow_pickle=True)
ann_model = SignLanguageNN(len(classes))
ann_model.load_state_dict(torch.load(os.path.join(BASE, 'sign_model.pth'), map_location='cpu'))
ann_model.eval()

print("[sign] Loading MediaPipe hand landmarker...")
base_options = python.BaseOptions(model_asset_path=os.path.join(BASE, 'hand_landmarker.task'))
options = vision.HandLandmarkerOptions(
    base_options=base_options,
    num_hands=2,
    min_hand_detection_confidence=0.5,
    min_hand_presence_confidence=0.5,
)
detector = vision.HandLandmarker.create_from_options(options)
print("[sign] Models loaded.")


# ── Main inference function ─────────────────────────────────────────────────
def predict_from_video(video_path: str, use_llm: bool = False) -> dict:
    """
    Process a video file frame by frame.
    Returns { "text": "hello how are you", "confidence": 0.87 }
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    sequence        = []       # collected word sequence
    current_word    = ""
    consecutive     = 0
    REQUIRED_FRAMES = 15       # same as sentence.py
    confidences     = []

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame     = cv2.flip(frame, 1)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        detection = detector.detect(mp_image)

        if not detection.hand_landmarks:
            continue

        hand_features = np.zeros(126)

        for i, hand_lm in enumerate(detection.hand_landmarks):
            if i > 1:
                break
            coords = []
            for lm in hand_lm:
                coords.extend([lm.x, lm.y, lm.z])
            hand_features[i * 63 : i * 63 + 63] = coords

        input_tensor = torch.tensor([hand_features], dtype=torch.float32)

        with torch.no_grad():
            outputs      = ann_model(input_tensor)
            probs        = torch.nn.functional.softmax(outputs, dim=1)
            conf, idx    = torch.max(probs, 1)
            predicted    = classes[idx.item()]
            score        = conf.item()

        if score > 0.60:                        # confidence threshold
            if predicted == current_word:
                consecutive += 1
            else:
                current_word = predicted
                consecutive  = 1

            if consecutive == REQUIRED_FRAMES:
                if not sequence or sequence[-1] != current_word:
                    sequence.append(current_word)
                    confidences.append(score)

    cap.release()

    if not sequence:
        return {"text": "", "confidence": 0.0}

    avg_confidence = float(np.mean(confidences)) if confidences else 0.0
    raw_sentence   = " ".join(sequence)

    # ── Optional: use Qwen LLM to form natural sentence ──
    if use_llm:
        try:
            natural = llm_stitch(raw_sentence)
            return {"text": natural, "confidence": avg_confidence}
        except Exception as e:
            print(f"[sign] LLM failed, falling back to raw: {e}")

    return {"text": raw_sentence.capitalize(), "confidence": avg_confidence}


def llm_stitch(words: str) -> str:
    """Use Qwen2.5 to convert raw sign words to natural sentence."""
    from transformers import AutoTokenizer, AutoModelForCausalLM

    model_id  = "Qwen/Qwen2.5-1.5B-Instruct"
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    llm       = AutoModelForCausalLM.from_pretrained(model_id)

    messages = [
        {"role": "system", "content": "You are a sign language translator. Convert the raw sign words into a single natural English sentence. Output only the sentence."},
        {"role": "user",   "content": f"Signs: {words}"}
    ]

    text    = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs  = tokenizer([text], return_tensors="pt")
    outputs = llm.generate(**inputs, max_new_tokens=50, temperature=0.6, do_sample=True)
    gen_ids = [o[len(i):] for i, o in zip(inputs.input_ids, outputs)]

    return tokenizer.batch_decode(gen_ids, skip_special_tokens=True)[0].strip()

# add at the bottom of sign_infer.py
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python sign_infer.py <video_path>")
        sys.exit(1)

    video_path = sys.argv[1]
    result     = predict_from_video(video_path, use_llm=False)
    print(result["text"])   # FastAPI reads this line