// SMT World on Firebase — the web app's Firebase config (11-20, buildathon).
//
// Paste the `firebaseConfig` object from: Firebase console → ⚙ Project settings → General →
// Your apps → (the web app) → SDK setup and configuration → Config.
//
// This object is PUBLIC BY DESIGN — every Firebase web app ships it to the browser; it
// names the project, it is not a password. The Gemini key itself never
// reaches the browser: Firebase AI Logic holds it on Google's side. On the free Spark plan
// no billing account is linked, so nobody can run up a bill with it; the worst abuse can
// do is use up the free daily quota.
export const firebaseConfig = {
  apiKey: "PASTE_FROM_FIREBASE_CONSOLE",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// The reCAPTCHA Enterprise KEY (a "Web" score-based key — public, like the config above).
// Google Cloud console → Security → Fraud Defense (reCAPTCHA) → Create key, domains
// <project>.web.app and <project>.firebaseapp.com; then register it in Firebase →
// App Check → Apps. Empty = App Check off on this build (the page says so if a call is refused).
export const recaptchaKey = "";
