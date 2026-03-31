import cv2
import torch
import torch.nn as nn
import numpy as np
import mediapipe as mp
import os
import threading
from dotenv import load_dotenv
import google.generativeai as genai
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# ==========================================
# 1. SETUP GEMINI API
# ==========================================
print("Loading Gemini API Configuration...")
load_dotenv() # Loads the .env file
API_KEY = os.getenv("GEMINI_API_KEY")

if not API_KEY:
    print("WARNING: GEMINI_API_KEY not found in .env file!")
else:
    genai.configure(api_key=API_KEY)

# Instantiate the Flash model
gemini_model = genai.GenerativeModel('gemini-2.5-flash')

# ==========================================
# 2. NEURAL NETWORK ARCHITECTURE
# ==========================================
class SignLanguageNN(nn.Module):
    def __init__(self, num_classes):
        super(SignLanguageNN, self).__init__()
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
        x = self.fc3(x)
        return x

# ==========================================
# 3. LOAD TRAINED MODEL AND LABELS
# ==========================================
print("Loading PyTorch Sign Model...")
classes = np.load('classes.npy', allow_pickle=True)
num_classes = len(classes)

model = SignLanguageNN(num_classes)
model.load_state_dict(torch.load('sign_model.pth'))
model.eval() 

# ==========================================
# 4. INITIALIZE MEDIAPIPE
# ==========================================
print("Loading MediaPipe Hand Landmarker...")
MODEL_PATH = 'hand_landmarker.task'
base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.HandLandmarkerOptions(
    base_options=base_options,
    num_hands=2,
    min_hand_detection_confidence=0.5,
    min_hand_presence_confidence=0.5
)
detector = vision.HandLandmarker.create_from_options(options)

# ==========================================
# 5. DRAWING & WRAPPING FUNCTIONS
# ==========================================
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),         
    (0, 5), (5, 6), (6, 7), (7, 8),         
    (9, 10), (10, 11), (11, 12),            
    (13, 14), (14, 15), (15, 16),           
    (17, 18), (18, 19), (19, 20),           
    (0, 17), (5, 9), (9, 13), (13, 17)      
]

def draw_custom_landmarks(image, landmarks):
    h, w, c = image.shape
    for connection in HAND_CONNECTIONS:
        idx1, idx2 = connection
        if idx1 < len(landmarks) and idx2 < len(landmarks):
            lm1, lm2 = landmarks[idx1], landmarks[idx2]
            cx1, cy1 = int(lm1.x * w), int(lm1.y * h)
            cx2, cy2 = int(lm2.x * w), int(lm2.y * h)
            cv2.line(image, (cx1, cy1), (cx2, cy2), (255, 255, 255), 2)
            
    for landmark in landmarks:
        cx, cy = int(landmark.x * w), int(landmark.y * h)
        cv2.circle(image, (cx, cy), 5, (0, 0, 255), -1)

# --- NEW: Helper function to wrap text neatly ---
def wrap_text(text, font, scale, thickness, max_width):
    words = text.split()
    lines = []
    current_line = ""
    for word in words:
        test_line = current_line + word + " "
        text_size = cv2.getTextSize(test_line, font, scale, thickness)[0]
        # If adding the next word makes it too long, push current line to array
        if text_size[0] > max_width and current_line != "":
            lines.append(current_line.strip())
            current_line = word + " "
        else:
            current_line = test_line
    if current_line:
        lines.append(current_line.strip())
    return lines

# ==========================================
# 6. TRANSLATION THREADING LOGIC
# ==========================================
sequence = []
current_word = ""
consecutive_frames = 0
REQUIRED_FRAMES = 15

stitched_sentence = ""
is_translating = False

def translate_with_gemini(current_sequence):
    """Runs in the background to translate gloss to English via Gemini."""
    global stitched_sentence, is_translating
    is_translating = True
    
    words = " ".join(current_sequence)
    prompt = f"You are a sign language translator. Convert the following sequence of signed words into a natural, grammatically correct English sentence. Only output the final sentence, nothing else. Words: {words}"
    
    try:
        response = gemini_model.generate_content(prompt)
        stitched_sentence = response.text.strip()
    except Exception as e:
        print(f"\nGemini API Error: {e}")
        stitched_sentence = "Error connecting to Gemini."
        
    is_translating = False

# ==========================================
# 7. WEBCAM LOOP
# ==========================================
cap = cv2.VideoCapture(0)
print("\nStarting webcam...")
print("Controls:")
print(" - Sign to build your sequence.")
print(" - Press 'ENTER' to translate with Gemini.")
print(" - Press 'BACKSPACE' to undo last word.")
print(" - Press 'c' to clear.")
print(" - Press 'q' to quit.")

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.flip(frame, 1)
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

    detection_result = detector.detect(mp_image)
    hand_features = np.zeros(126)

    if detection_result.hand_landmarks:
        for i, hand_landmarks in enumerate(detection_result.hand_landmarks):
            if i > 1: break
            draw_custom_landmarks(frame, hand_landmarks)

            coords = []
            for landmark in hand_landmarks:
                coords.extend([landmark.x, landmark.y, landmark.z])
                
            start_idx = i * 63
            end_idx = start_idx + 63
            hand_features[start_idx:end_idx] = coords

        input_tensor = torch.tensor([hand_features], dtype=torch.float32)
        
        with torch.no_grad():
            outputs = model(input_tensor)
            probabilities = torch.nn.functional.softmax(outputs, dim=1)
            confidence, predicted_idx = torch.max(probabilities, 1)
            
            predicted_class = classes[predicted_idx.item()]
            confidence_score = confidence.item() * 100

            if confidence_score > 60:
                # Top-Left Box: Current Prediction
                display_text = f"{predicted_class.upper()} ({confidence_score:.1f}%)"
                cv2.rectangle(frame, (10, 10), (400, 70), (0, 0, 0), -1)
                cv2.putText(frame, display_text, (20, 50), 
                            cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)

                if predicted_class == current_word:
                    consecutive_frames += 1
                else:
                    current_word = predicted_class
                    consecutive_frames = 1

                if consecutive_frames == REQUIRED_FRAMES:
                    if len(sequence) == 0 or sequence[-1] != current_word:
                        sequence.append(current_word)

    # --- NEW: SEPARATE UI PANEL (NO OVERLAP) ---
    h, w, c = frame.shape
    UI_HEIGHT = 180 # Fixed height for the text panel underneath
    ui_panel = np.zeros((UI_HEIGHT, w, c), dtype=np.uint8)
    
    # 1. Display the Raw Sequence (Wrapped)
    raw_text = "RAW: " + " ".join(sequence).upper()
    raw_lines = wrap_text(raw_text, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2, w - 40)
    
    y_offset = 30
    for line in raw_lines:
        cv2.putText(ui_panel, line, (20, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (150, 150, 150), 2)
        y_offset += 30 # Move down for the next line
        
    y_offset += 10 # Extra gap between RAW and GEMINI text

    # 2. Display the Translated Sentence (Wrapped)
    if is_translating:
        gemini_text = "OUTPUT: Translating..."
    else:
        gemini_text = "OUTPUT: " + stitched_sentence

    gemini_lines = wrap_text(gemini_text, cv2.FONT_HERSHEY_SIMPLEX, 0.9, 2, w - 40)
    
    for line in gemini_lines:
        cv2.putText(ui_panel, line, (20, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        y_offset += 35 # Move down for the next line

    # 3. Display simple instructions at the very bottom
    controls_text = "[ENTER] Translate | [BACKSPACE] Undo | [C] Clear | [Q] Quit"
    # Scaled down slightly (0.45) to ensure it fits horizontally on a standard 640px webcam width
    cv2.putText(ui_panel, controls_text, (20, UI_HEIGHT - 15), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 100, 100), 1)

    # Combine video frame and UI panel perfectly
    final_display = np.vstack((frame, ui_panel))

    cv2.imshow('Live Sign Language Detection', final_display)

    # --- KEYBOARD CONTROLS ---
    key = cv2.waitKey(1) & 0xFF
    
    if key == ord('q'):
        break
    elif key == ord('c'): 
        sequence = []
        stitched_sentence = ""
        current_word = ""
    elif key == 8: # ASCII for 'Backspace'
        if len(sequence) > 0:
            sequence.pop()
            stitched_sentence = "" 
    elif key == 13: # ASCII for 'Enter'
        if len(sequence) > 0 and not is_translating:
            threading.Thread(target=translate_with_gemini, args=(sequence.copy(),), daemon=True).start()

cap.release()
cv2.destroyAllWindows()