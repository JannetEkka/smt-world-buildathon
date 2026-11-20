// E2E stand-in for gstatic firebase-auth.js: a Google sign-in that succeeds as window.__mock.user.
let current = null; const subs = [];
const fire = () => subs.forEach(f => f(current));
export class GoogleAuthProvider {}
export function getAuth() { return { kind: "e2e-auth" }; }
export function onAuthStateChanged(auth, fn) { subs.push(fn); setTimeout(() => fn(current), 0); return () => {}; }
export async function signInWithPopup() {
  const u = (window.__mock || {}).user || { uid: "priya", displayName: "Priya Das", email: "priya@example.com", photoURL: "" };
  current = { ...u }; window.__signedInWith = "popup"; fire(); return { user: current };
}
export async function signInWithRedirect() { return signInWithPopup(); }
export async function getRedirectResult() { return null; }
export async function signOut() { current = null; fire(); }
