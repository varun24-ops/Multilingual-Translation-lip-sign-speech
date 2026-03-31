import os
import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# 1. Setup paths 
DATASET_PATH = r"D:\Sign Language Detection YOLO\dataset5" 
THIS_DATASET_PATH = "./dataset"
SPLITS = ['train', 'val']
MODEL_PATH = 'hand_landmarker.task' # The file you just downloaded

# 2. Initialize the new MediaPipe Tasks API
base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.HandLandmarkerOptions(
    base_options=base_options,
    num_hands=2,
    min_hand_detection_confidence=0.3,
    min_hand_presence_confidence=0.3
)
detector = vision.HandLandmarker.create_from_options(options)

extracted_data = []

for split in SPLITS:
    image_dir = os.path.join(DATASET_PATH, split, 'images')
    
    if not os.path.exists(image_dir):
        print(f"Directory not found: {image_dir}")
        continue
        
    print(f"Processing {split} images...")
    
    for filename in os.listdir(image_dir):
        if not filename.lower().endswith(('.png', '.jpg', '.jpeg')):
            continue
            
        word_label = filename.split('_')[0]
        img_path = os.path.join(image_dir, filename)
        image = cv2.imread(img_path)
        
        if image is None:
            continue
            
        # The new API requires a specific mp.Image object instead of a raw numpy array
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
        
        # Process the image
        detection_result = detector.detect(mp_image)
        
        # Setup the 126-feature array (zeros by default for missing hands)
        hand_features = np.zeros(126)
        
        # The new API returns hand_landmarks instead of multi_hand_landmarks
        if detection_result.hand_landmarks:
            for i, hand_landmarks in enumerate(detection_result.hand_landmarks):
                if i > 1: break # Safety catch
                
                coords = []
                for landmark in hand_landmarks:
                    coords.extend([landmark.x, landmark.y, landmark.z])
                    
                start_idx = i * 63
                end_idx = start_idx + 63
                hand_features[start_idx:end_idx] = coords
                
            row = [word_label, split] + hand_features.tolist()
            extracted_data.append(row)
        else:
            print(f"Warning: No hands detected in {filename}. Skipping.")

# 3. Save to CSV
columns = ['label', 'split'] + [f'coord_{i}' for i in range(126)]
df = pd.DataFrame(extracted_data, columns=columns)

os.makedirs(THIS_DATASET_PATH, exist_ok=True)

output_csv = os.path.join(THIS_DATASET_PATH, 'mediapipe_dataset.csv')
df.to_csv(output_csv, index=False)

print(f"\nExtraction complete! Saved {len(df)} successful rows to {output_csv}")