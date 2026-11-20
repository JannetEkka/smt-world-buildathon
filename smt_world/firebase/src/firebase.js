// SMT World on Firebase — the ONE Firebase app (11-20). ask.js (Gemini) and account.js (sign-in,
// Firestore) both import it, so App Check is switched on once, before any Firebase call.
//
// App Check proves a call comes from THIS site (Firebase turned enforcement on for AI Logic
// automatically on 2026-11-02). Fraud Defense, formerly reCAPTCHA Enterprise, is the web
// provider; its key is public, and on the Spark plan it runs on the free tier.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js";
import * as CFG from "./firebase-config.js";

export const firebaseConfig = CFG.firebaseConfig;
export const SCREEN_URL = CFG.screenUrl || "";   // optional Model Armor route (README)
export const configured = !!(firebaseConfig && firebaseConfig.apiKey && !/PASTE|YOUR_/i.test(firebaseConfig.apiKey));

export let app = null, appCheck = null, APPCHECK = "off";
if (configured) {
  try {
    app = initializeApp(firebaseConfig);
    if (CFG.recaptchaKey) {
      appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(CFG.recaptchaKey), isTokenAutoRefreshEnabled: true });
      APPCHECK = "on";
    } else console.warn("[FIREBASE] App Check is OFF on this build (no recaptchaKey in firebase-config.js) — if Firebase enforces App Check, calls will be refused");
  } catch (e) { console.error("[FIREBASE] init failed", e); app = null; }
}
