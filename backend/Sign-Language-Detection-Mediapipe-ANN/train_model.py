import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import LabelEncoder
import numpy as np
import warnings

# Suppress the pandas fragmentation warning
warnings.simplefilter(action='ignore', category=pd.errors.PerformanceWarning)

# 1. Prepare the Data
CSV_PATH = r"./dataset/mediapipe_dataset.csv"
# Added .copy() to fix the DataFrame fragmentation warning
df = pd.read_csv(CSV_PATH).copy() 

# Encode text labels
label_encoder = LabelEncoder()
df['label_encoded'] = label_encoder.fit_transform(df['label'])
num_classes = len(label_encoder.classes_)
print(f"Detected {num_classes} classes: {label_encoder.classes_}")

train_df = df[df['split'] == 'train']
val_df = df[df['split'] == 'val']

# 2. Define a Custom PyTorch Dataset with AUGMENTATION
class SignLanguageDataset(Dataset):
    def __init__(self, dataframe, augment=False):
        self.X = dataframe.loc[:, 'coord_0':'coord_125'].values.astype(np.float32)
        self.y = dataframe['label_encoded'].values.astype(np.int64)

        if augment:
            # AUGMENTATION 1: Horizontal Flipping (Left hand becomes Right hand)
            X_flipped = self.X.copy()
            # x-coordinates are at indices 0, 3, 6, 9...
            for i in range(0, 126, 3): 
                # Only flip valid coordinates to preserve our zero-padding!
                valid_coords = X_flipped[:, i] != 0
                X_flipped[valid_coords, i] = 1.0 - X_flipped[valid_coords, i]
            
            # AUGMENTATION 2: Random Jitter (Simulates slight hand movements)
            # Adds max 2% spatial shift
            noise = np.random.normal(0, 0.02, self.X.shape).astype(np.float32)
            noise[self.X == 0] = 0 # Keep zero-padding intact
            X_jittered = self.X + noise

            # Combine Original + Flipped + Jittered (Triples the dataset!)
            self.X = np.vstack((self.X, X_flipped, X_jittered))
            self.y = np.concatenate((self.y, self.y, self.y))
            print(f"Augmentation applied! Training rows increased to: {len(self.X)}")

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return torch.tensor(self.X[idx]), torch.tensor(self.y[idx])

# Apply augmentation ONLY to training data, never to validation data
train_dataset = SignLanguageDataset(train_df, augment=True)
val_dataset = SignLanguageDataset(val_df, augment=False)

train_loader = DataLoader(train_dataset, batch_size=16, shuffle=True)
val_loader = DataLoader(val_dataset, batch_size=16, shuffle=False)

# 3. Define the Neural Network Architecture
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

model = SignLanguageNN(num_classes)

# 4. Training Setup
criterion = nn.CrossEntropyLoss()
optimizer = optim.Adam(model.parameters(), lr=0.001)
# Bumped epochs to 100 to give it time to learn the new flipped data
EPOCHS = 100 

# 5. The Training Loop
print("\nStarting Training...")
for epoch in range(EPOCHS):
    model.train()
    running_loss = 0.0
    
    for inputs, labels in train_loader:
        optimizer.zero_grad()
        outputs = model(inputs)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()
        running_loss += loss.item()
        
    # Validation Phase
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for inputs, labels in val_loader:
            outputs = model(inputs)
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
            
    val_accuracy = 100 * (correct / total) if total > 0 else 0
    
    # Print progress every 10 epochs
    if (epoch + 1) % 10 == 0:
        print(f"Epoch [{epoch+1}/{EPOCHS}] - Loss: {running_loss/len(train_loader):.4f} - Val Accuracy: {val_accuracy:.2f}%")

# Save the trained model weights and the label classes
torch.save(model.state_dict(), 'sign_model.pth')
np.save('classes.npy', label_encoder.classes_)
print("\nTraining Complete! Model saved as 'sign_model.pth'")