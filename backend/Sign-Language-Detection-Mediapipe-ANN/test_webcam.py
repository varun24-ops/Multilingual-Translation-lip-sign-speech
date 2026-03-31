import cv2
import torch
import torch.nn as nn
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# 1. Re-define the Neural Network Architecture
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

# 2. Load the trained Model and Labels
classes = np.load('classes.npy', allow_pickle=True)
num_classes = len(classes)

model = SignLanguageNN(num_classes)
model.load_state_dict(torch.load('sign_model.pth'))
model.eval() 

# 3. Initialize MediaPipe Tasks API
MODEL_PATH = 'hand_landmarker.task'
base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.HandLandmarkerOptions(
    base_options=base_options,
    num_hands=2,
    min_hand_detection_confidence=0.5,
    min_hand_presence_confidence=0.5
)
detector = vision.HandLandmarker.create_from_options(options)

# 4. Custom OpenCV Drawing Function
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

# --- NEW: SEQUENCE BUFFER VARIABLES ---
sequence = []
current_word = ""
consecutive_frames = 0
REQUIRED_FRAMES = 15 # Must see the same sign for 15 frames to register it

# 5. Start the Webcam
cap = cv2.VideoCapture(0)
print("\nStarting webcam...")
print("Controls: Press 'c' to clear the sentence. Press 'q' to quit.")

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

                # --- NEW: DEBOUNCING LOGIC ---
                if predicted_class == current_word:
                    consecutive_frames += 1
                else:
                    current_word = predicted_class
                    consecutive_frames = 1

                # If we hit the required frame count, append to sequence
                if consecutive_frames == REQUIRED_FRAMES:
                    # Only add if the sequence is empty, OR if the new word is different from the last one
                    if len(sequence) == 0 or sequence[-1] != current_word:
                        sequence.append(current_word)
                        
    # --- NEW: UI FOR SENTENCE BUFFER ---
    # Draw a dark bar at the bottom
    h, w, _ = frame.shape
    cv2.rectangle(frame, (0, h - 60), (w, h), (0, 0, 0), -1)
    
    # Display the sentence
    sentence_text = " ".join(sequence).upper()
    cv2.putText(frame, sentence_text, (20, h - 20), 
                cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

    cv2.imshow('Live Sign Language Detection', frame)

    key = cv2.waitKey(1) & 0xFF
    if key == ord('q'):
        break
    elif key == ord('c'): # Press 'c' to clear the buffer
        sequence = []

cap.release()
cv2.destroyAllWindows()