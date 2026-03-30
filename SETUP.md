# Pocket Money Tracker — Setup Guide

Follow these steps once. Total time: about 10–15 minutes.

---

## Step 1 — Create a Firebase project (free)

1. Go to **https://console.firebase.google.com** and sign in with a Google account
2. Click **"Add project"**
3. Name it `pocket-money`, click Continue
4. **Disable** Google Analytics (not needed), click **"Create project"**
5. Wait for it to finish, then click **"Continue"**

---

## Step 2 — Create a Firestore database

1. In the left sidebar, click **Build → Firestore Database**
2. Click **"Create database"**
3. Choose **"Start in test mode"** (allows reads/writes for 30 days — you'll extend this below)
4. Pick a location: **europe-west2** (London) is ideal
5. Click **"Enable"**

### Extend the security rules (important)
After Firestore is created, click the **Rules** tab and replace the content with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Click **"Publish"**. This keeps the database open — fine for a private family app.

---

## Step 3 — Get your Firebase config

1. In Firebase, click the **gear icon ⚙** → **Project settings**
2. Scroll down to **"Your apps"** — if there's no app listed, click the **web icon `</>`**
3. Name it `pocket-money-web`, leave "Firebase Hosting" unchecked, click **"Register app"**
4. You'll see a block like this:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "pocket-money-xxxxx.firebaseapp.com",
  projectId: "pocket-money-xxxxx",
  storageBucket: "pocket-money-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

5. Open the **`config.js`** file in this folder with any text editor (Notepad on Windows, TextEdit on Mac)
6. Replace each `REPLACE_WITH_YOUR_...` value with the matching value from Firebase
7. **Save the file**

---

## Step 4 — Deploy to Netlify

1. Go to **https://app.netlify.com** and create a free account (or log in)
2. From your dashboard, find the **"Add new site"** button → **"Deploy manually"**
3. Drag the entire **`pwa-v2` folder** onto the upload area
4. Netlify gives you a URL like `https://random-name-123.netlify.app` — this is your app!

---

## Step 5 — Add Netlify environment variables (for push notifications)

This is what allows the notification to actually fire when Logan submits a chore.

1. In Netlify, go to your site → **Site configuration → Environment variables**
2. Add these three variables (click **"Add a variable"** for each):

| Key | Value |
|-----|-------|
| `VAPID_PUBLIC_KEY` | `BAfwyRWC4YKulte6dU6peeUDDZt3FHLGsL7Ob9uoXNrjUx2Ti4RJR3Kliw1JpPq6DNykCZjfCYrCZDmHEQpVWkA` |
| `VAPID_PRIVATE_KEY` | `WmuFnLUx8xit9NEAROMidMyYSPUr_bUCLWhL9J1vC5A` |
| `CONTACT_EMAIL` | your email address |

3. After adding all three, go to **Deploys → Trigger deploy → Deploy site** to redeploy with the new variables

---

## Step 6 — Install on your phones

### Your phone (Android — Chrome)
1. Open your Netlify URL in **Chrome**
2. Tap the three-dot menu → **"Add to Home screen"**
3. Open the app, tap **Boss**, enter PIN `1234`
4. Go to **Settings** and tap **"Enable notifications"** — grant permission when asked
5. Done — you'll now get notified when Logan logs a chore

### Logan's phone (Android — Chrome)
1. Open the same Netlify URL in **Chrome**
2. Tap the three-dot menu → **"Add to Home screen"**
3. Done — Logan uses the app normally

### iPhones (must use Safari)
1. Open the Netlify URL in **Safari**
2. Tap the **Share button** (box with arrow) → **"Add to Home Screen"**
3. Launch from the home screen icon
4. For push notifications: must be iOS 16.4 or later

---

## How it works once set up

- Logan logs a completed chore on his phone → **instant notification on your phone**
- Logan submits a job suggestion → **notification on your phone**
- Both phones see the same live data — any change on one phone appears on the other within seconds
- Works offline too — changes sync when connection is restored

---

## Troubleshooting

**"The app shows a setup screen"** — You haven't saved your Firebase config into `config.js` yet, or the config has a typo. Open `config.js` and check all values match exactly what Firebase showed you.

**"Notifications don't arrive"** — Make sure you tapped "Enable notifications" in Boss → Settings on YOUR phone specifically. Also check that Netlify environment variables are saved and you redeployed after adding them.

**"iOS notifications not working"** — iOS only supports PWA push notifications on iOS 16.4+, and only when the app is installed via "Add to Home Screen". It won't work if you just open the URL in Safari without installing it.

**"Firestore errors in console"** — Your test mode rules may have expired (they last 30 days). Go back to Firestore → Rules and republish the open rules from Step 2.
