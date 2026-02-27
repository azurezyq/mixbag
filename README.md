# mixbag

Mixbag is a dynamic checklist management application designed for people who need modular, reusable lists for complex life events. Whether you're packing for a ski trip, planning a weekly grocery run, or preparing for a hike, Mixbag helps you combine your "template" lists into perfectly tailored checklists.

## 🚀 Vision
Don't reinvent the wheel every time you pack or plan. Define your base sets once, mix them whenever you need, and let AI help you refine the details.

## ✨ Core Features
- **Google Account Auth**: Seamless and secure login using your Google account.
- **Modular Checklists**: maintain a library of "Base Checklists" (e.g., Summer Hiking, Camera Gear, Basic Groceries).
- **The "Mixer"**: Select multiple base checklists and merge them into a new, unique checklist for a specific event (e.g., "Tahoe Ski Trip 2026").
- **Smart Ticking**: A clean, mobile-optimized interface for ticking off items on the go.
- **Organization**: Star your most-used lists and tag them for quick filtering.
- **AI-Powered Refinement**:
    - Use AI to suggest additions based on your list title (e.g., "Oh, you're going to Tahoe? Don't forget tire chains and high-SPF sunscreen").
    - "Temp Changes" UI: Review AI suggestions, see diffs, and bulk-accept changes.

## 🎨 Design Requirements
- **Premium Aesthetics**: A state-of-the-art dark mode interface with glassmorphism elements and smooth micro-animations.
- **Mobile & Desktop Friendly**: Fully responsive layout that feels like a native app on mobile while utilizing horizontal space on desktop.
- **Visual Feedback**: Vibrant color transitions when items are checked and subtle glow effects for "starred" lists.

## 🛠 Tech Stack
- **Platform**: Google Firebase (Firestore, Auth, Firebase Admin SDK).
- **Backend API**: Python (Flask).
- **Frontend**: HTML5, Vanilla CSS, JS (Premium UI).
- **AI**: Integrated with Vertex AI (Gemini 2.5 Flash) for intelligent list manipulation.

## ⚙️ Setup & Deployment

### 1. Environment Configuration
Copy the example environment file and fill in your credentials:
```bash
cp .env.example .env
```
Ensure you have:
- A Google Cloud Service Account JSON key for Firebase Admin access (set `GOOGLE_APPLICATION_CREDENTIALS`).
- Your Firebase Client Config fields (`FB_API_KEY`, etc.) which are now injected dynamically to avoid commitment to Git.

### 2. Install Dependencies
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Seed Firestore (Optional)
To populate your Firestore with base templates:
```bash
python seed_firestore.py
```

### 4. Run Locally
```bash
python app.py
```

### 5. Deployment
The project is configured for Cloud Run and Firebase Hosting.
```bash
gcloud run deploy mixbag-service --source .
firebase deploy --only hosting
```

---
*Created by Antigravity AI*
