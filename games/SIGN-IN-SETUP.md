# Turning on "Sign in with Google" for Hammerfall Games

Sign-in uses **Firebase** (free, by Google). It saves each player's chess rating and win/loss record to their Google account, so it follows them to any device. Until you finish these steps, the sign-in button just says it isn't set up yet, and everything else works normally.

## 1. Create a Firebase project (about 2 minutes)
1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project**, name it (for example `hammerfall-games`), and finish the wizard. You can turn Google Analytics off.

## 2. Turn on Google sign-in
1. In the left menu: **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Google** → switch **Enable** on → pick a support email → **Save**.
3. **Settings** tab → **Authorized domains** → **Add domain** → `phelypsam-del.github.io`.

## 3. Create the database
1. Left menu: **Build → Firestore Database → Create database**.
2. Pick a location near you and start in **production mode**.
3. Open the **Rules** tab, replace everything with the rules below, and click **Publish**.
   They let each signed-in player read and write **only their own** save data.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /players/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 4. Connect the website
1. Click the gear icon → **Project settings** → scroll to **Your apps** → click the **`</>`** (Web) icon.
2. Give it a nickname (for example `games site`) and click **Register app**. You don't need Firebase Hosting.
3. Copy the `firebaseConfig = { ... }` block it shows you.
4. Paste it into `games/firebase-config.js`, replacing `null`, so it reads `export const firebaseConfig = { ... };`.
   (Or send the block to Claude and it will add it for you.)

The values in that block are safe to publish. They only identify your project, and the rules in step 3 are what protect players' data.
