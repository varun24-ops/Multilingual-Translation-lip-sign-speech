import cv2
import torch
import torch.nn as nn
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import threading
import warnings
from transformers import AutoTokenizer, AutoModelForCausalLM

# Suppress some Hugging Face warnings to keep the console clean
warnings.filterwarnings('ignore')

# ==========================================
# 1. NEURAL NETWORK ARCHITECTURE
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
# 2. LOAD TRAINED MODEL AND LABELS
# ==========================================
print("Loading PyTorch Sign Model...")
classes = np.load('classes.npy', allow_pickle=True)
num_classes = len(classes)

model = SignLanguageNN(num_classes)
model.load_state_dict(torch.load('sign_model.pth'))
model.eval() 

# ==========================================
# 3. INITIALIZE MEDIAPIPE
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
# 4. DRAWING FUNCTION
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

# ==========================================
# 5. LLM SETUP & THREADING LOGIC
# ==========================================
print("Loading Advanced Language Model (this will take a moment)...")
model_id = "Qwen/Qwen2.5-1.5B-Instruct"

tokenizer = AutoTokenizer.from_pretrained(model_id)
# AutoModelForCausalLM is used for modern chat-based AI models
llm_model = AutoModelForCausalLM.from_pretrained(model_id)

# State variables for sequence and LLM
sequence = []
current_word = ""
consecutive_frames = 0
REQUIRED_FRAMES = 15

stitched_sentence = ""
is_translating = False

def stitch_sentence_worker(current_sequence):
    """Runs in the background to translate gloss to English using a Chat Model."""
    global stitched_sentence, is_translating
    is_translating = True
    
    words = " ".join(current_sequence)
    
    # 1. Define the Chat Context
    messages = [
        {"role": "system", "content": "You are an expert sign language translator. The user will give you a sequence of English words translated directly from sign language. Your only job is to rewrite them into a single, natural, and grammatically correct English sentence. Do not add any extra commentary, conversational filler, or explanations. Just output the final sentence."},
        {"role": "user", "content": f"Translate these signs: {words}"}
    ]
    
    try:
        # 2. Format the messages into the model's specific chat template
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer([text], return_tensors="pt")
        
        # 3. Generate the response
        outputs = llm_model.generate(
            **inputs, 
            max_new_tokens=50,
            do_sample=True,
            temperature=0.6, # 0.6 is a great balance between creativity and accuracy
        )
        
        # 4. Slice off the prompt so we only get the newly generated sentence
        generated_ids = [output_ids[len(input_ids):] for input_ids, output_ids in zip(inputs.input_ids, outputs)]
        stitched_sentence = tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
        
    except Exception as e:
        print(f"LLM Error: {e}")
        stitched_sentence = "Error translating."
        
    is_translating = False

# ==========================================
# 6. WEBCAM LOOP
# ==========================================
cap = cv2.VideoCapture(0)
print("\nStarting webcam...")
print("Controls:")
print(" - Sign to build your sequence.")
print(" - Press 'ENTER' to translate the sequence.")
print(" - Press 'c' to clear the current sequence and translation.")
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

    # --- LANDMARK EXTRACTION & PREDICTION ---
    if detection_result.hand_landmarks:
        for i, hand_landmarks in enumerate(detection_result.hand_landmarks):
            if i > 1: break # Only process up to 2 hands
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

                # --- DEBOUNCING LOGIC ---
                if predicted_class == current_word:
                    consecutive_frames += 1
                else:
                    current_word = predicted_class
                    consecutive_frames = 1

                # If we hit the required frame count, append to sequence
                if consecutive_frames == REQUIRED_FRAMES:
                    # Add if sequence is empty, OR if the new word is different from the last one
                    if len(sequence) == 0 or sequence[-1] != current_word:
                        sequence.append(current_word)

    # --- UI FOR SENTENCE BUFFER & TRANSLATION ---
    h, w, _ = frame.shape
    # Draw a larger dark bar at the bottom to fit text and instructions
    cv2.rectangle(frame, (0, h - 120), (w, h), (0, 0, 0), -1)
    
    # 1. Display the Raw Sequence (what the NN sees)
    raw_text = "RAW: " + " ".join(sequence).upper()
    cv2.putText(frame, raw_text, (20, h - 85), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (150, 150, 150), 2)

    # 2. Display the Translated Sentence (what the LLM outputs)
    if is_translating:
        cv2.putText(frame, "LLM: Translating...", (20, h - 45), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
    else:
        cv2.putText(frame, "LLM: " + stitched_sentence, (20, h - 45), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)

    # 3. Display simple instructions at the very bottom
    cv2.putText(frame, "[ENTER] Translate | [C] Clear | [Q] Quit", (20, h - 15), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 100, 100), 1)

    cv2.imshow('Live Sign Language Detection', frame)

    # --- KEYBOARD CONTROLS ---
    key = cv2.waitKey(1) & 0xFF
    
    if key == ord('q'):
        break
    elif key == ord('c'): 
        # Clear everything
        sequence = []
        stitched_sentence = ""
        current_word = ""
    elif key == 13: # 13 is the ASCII code for the 'Enter' key
        # Trigger the LLM only if there are words and we aren't already translating
        if len(sequence) > 0 and not is_translating:
            threading.Thread(target=stitch_sentence_worker, args=(sequence.copy(),), daemon=True).start()

cap.release()
cv2.destroyAllWindows()