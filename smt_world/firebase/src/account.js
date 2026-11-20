// SMT World on Firebase — sign in with Google; your Calls and questions follow you (11-20).
//
// Firebase Authentication (Google provider) + Cloud Firestore, both on the free Spark plan.
//   users/{uid}                {name, lang, lastSeen}
//   users/{uid}/calls/{COIN@t0} one Call against SMT (lib/sync.js CALL_KEYS)
//   users/{uid}/questions/{id}  {q, lang, outcome, layer, at} — one Ask SMT turn
// firestore.rules lets a user read and write only their own documents, only these fields.
//
// Signed out, nothing changes: the world, Ask SMT and Calls all work as a guest, Calls kept in
// this browser. Signing in merges this browser's Calls with the account's and keeps them in step.
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, getDocs, addDoc, query, orderBy, limit, serverTimestamp, writeBatch }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore-lite.js";
import { app } from "./firebase.js";
import * as S from "./lib/sync.js";

const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lang = () => { try { return localStorage.getItem("smt_ask_lang") || "en"; } catch (e) { return "en"; } };
const T = {
  signin:   { en: "Continue with Google", hi: "Google से जारी रखें", bn: "Google দিয়ে চালিয়ে যান" },
  why:      { en: "Free. Your calls against SMT and your questions are saved to your account, on any device.", hi: "मुफ़्त। SMT के ख़िलाफ़ आपके कॉल और आपके सवाल आपके खाते में सहेजे जाते हैं, किसी भी डिवाइस पर।", bn: "বিনামূল্যে। SMT-র বিরুদ্ধে আপনার কল আর প্রশ্ন আপনার অ্যাকাউন্টে থাকে, যেকোনো ডিভাইসে।" },
  hello:    { en: "Signed in as", hi: "साइन इन:", bn: "সাইন ইন:" },
  calls:    { en: "Your calls against SMT", hi: "SMT के ख़िलाफ़ आपके कॉल", bn: "SMT-র বিরুদ্ধে আপনার কল" },
  recent:   { en: "Your recent questions", hi: "आपके हाल के सवाल", bn: "আপনার সাম্প্রতিক প্রশ্ন" },
  none:     { en: "None yet. Ask SMT anything.", hi: "अभी कोई नहीं। SMT से कुछ भी पूछिए।", bn: "এখনো নেই। SMT-কে যা খুশি জিজ্ঞেস করুন।" },
  out:      { en: "Sign out", hi: "साइन आउट", bn: "সাইন আউট" },
  failed:   { en: "Sign-in didn't finish: ", hi: "साइन-इन पूरा नहीं हुआ: ", bn: "সাইন-ইন শেষ হয়নি: " },
  sync:     { en: "Saved to your account", hi: "आपके खाते में सहेजा गया", bn: "আপনার অ্যাকাউন্টে সংরক্ষিত" },
};
const t = k => T[k][lang()] || T[k].en;

let auth = null, db = null, USER = null;
const written = new Map();   // call id → JSON last written, so a save writes only what changed
let pushing = Promise.resolve();
if (app) {
  try { auth = getAuth(app); db = getFirestore(app); }
  catch (e) { console.error("[ACCOUNT] Auth/Firestore init failed", e); }
}

// ── Calls: pull on sign-in, merge, push every change ─────────────────────────────────
async function pullCalls(uid) {
  const snap = await getDocs(collection(db, "users", uid, "calls"));
  const remote = []; snap.forEach(d => remote.push(d.data()));
  for (const c of remote) { const x = S.cleanCall(c); if (x) written.set(S.callDocId(x), JSON.stringify(x)); }
  return remote;
}
async function pushCalls(calls) {
  if (!USER || !db) return;
  const changed = S.changedCalls(calls, written);
  if (!changed.length) return;
  const batch = writeBatch(db);
  for (const c of changed.slice(-400)) batch.set(doc(db, "users", USER.uid, "calls", S.callDocId(c)), c);
  await batch.commit();
  for (const c of changed) written.set(S.callDocId(c), JSON.stringify(c));
  console.log(`[ACCOUNT] ${changed.length} call(s) saved to the account`);
}
// app.js saveCalls → here (after its localStorage write); queued so writes never overlap
window.SMT_CALLS_SAVED = calls => {
  if (!USER) return;
  pushing = pushing.then(() => pushCalls(calls)).catch(e => console.warn("[ACCOUNT] saving calls failed: " + String(e && e.message || e).slice(0, 160)));
};
window.SMT_CALLS_NOTE = () => USER ? `${t("sync")} (${esc(USER.name)}).` : null;

// ── Questions: one record per Ask SMT turn (ask.js calls this) ─────────────────────────
window.SMT_LOG_QUESTION = async (q, qlang, outcome, layer) => {
  if (!USER || !db) return;
  try { await addDoc(collection(db, "users", USER.uid, "questions"), { ...S.questionRecord(q, qlang, outcome, layer), at: serverTimestamp() }); }
  catch (e) { console.warn("[ACCOUNT] saving the question failed: " + String(e && e.message || e).slice(0, 160)); }
};
async function recentQuestions(uid) {
  try {
    const snap = await getDocs(query(collection(db, "users", uid, "questions"), orderBy("at", "desc"), limit(5)));
    const out = []; snap.forEach(d => out.push(d.data())); return out;
  } catch (e) { console.warn("[ACCOUNT] reading questions failed: " + String(e && e.message || e).slice(0, 160)); return []; }
}

// ── Sign in / out ───────────────────────────────────────────────────────────────────
async function signIn() {
  if (!auth) return showError("Firebase isn't set up on this build");
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    const code = String(e && e.code || "");
    if (/popup-blocked|operation-not-supported/.test(code)) return signInWithRedirect(auth, provider);   // phones that block pop-ups
    if (!/popup-closed-by-user|cancelled-popup-request/.test(code)) showError(code || String(e && e.message || e));
  }
}
function showError(msg) {
  const el = document.getElementById("acctMsg");
  if (el) el.textContent = t("failed") + msg;
  console.warn("[ACCOUNT] sign-in failed: " + msg);
}

// ── The sign-in panel (index.html #login) on this build: Google sign-in, then "My SMT" ──
function renderPanel(questions) {
  const box = document.getElementById("acctBox"); if (!box) return;
  if (!USER) {
    box.innerHTML = `<button type="button" class="login-google" id="googleBtn"><span aria-hidden="true">G</span> ${esc(t("signin"))}</button>
      <p class="login-note muted">${esc(t("why"))}</p><p class="login-note" id="acctMsg" role="status"></p>`;
    box.querySelector("#googleBtn").addEventListener("click", signIn);
    return;
  }
  const sc = S.score(typeof loadCalls === "function" ? loadCalls() : []);
  const qs = (questions || []).map(q => `<li><button type="button" class="acct-q" data-q="${esc(q.q)}">${esc(q.q)}</button>
      <span class="muted small">${q.outcome === "refused" ? "🛑" : "✓"}</span></li>`).join("");
  box.innerHTML = `<div class="acct-me">${USER.photo ? `<img src="${esc(USER.photo)}" alt="" referrerpolicy="no-referrer"/>` : ""}
      <div><span class="muted small">${esc(t("hello"))}</span><br><b>${esc(USER.name)}</b></div></div>
    <div class="acct-stat"><span>${esc(t("calls"))}</span><b>You ${sc.you.right}/${sc.you.of} · SMT ${sc.smt.right}/${sc.smt.of}</b></div>
    <div class="acct-stat"><span>${esc(t("recent"))}</span></div>
    <ul class="acct-qs">${qs || `<li class="muted small">${esc(t("none"))}</li>`}</ul>
    <button type="button" class="login-guest" id="signOutBtn">${esc(t("out"))}</button>`;
  box.querySelector("#signOutBtn").addEventListener("click", () => signOut(auth));
  box.querySelectorAll(".acct-q").forEach(b => b.addEventListener("click", () => {
    if (typeof closeLogin === "function") closeLogin();
    if (typeof openChat === "function") openChat();
    if (typeof askGuide === "function") askGuide(b.dataset.q);
  }));
}
// the HUD pill says who is signed in (app.js syncPill asks this first)
window.SMT_PILL = pill => {
  if (!USER) return false;
  pill.textContent = USER.name.split(" ")[0] + " ✓";
  pill.onclick = () => { if (typeof openLogin === "function") openLogin(); };
  return true;
};

function install() {
  const card = document.querySelector("#login .login-card");
  if (!card) return console.error("[ACCOUNT] the sign-in panel was not found");
  // the founder sign-in is Cloudflare Access on workers.dev; it does not exist on this host
  card.querySelectorAll(".login-guest, .login-note").forEach(el => el.remove());
  const p = card.querySelector("p.muted"); if (p) p.textContent = "No sign-in needed to explore. Sign in to keep your calls and questions.";
  const box = document.createElement("div"); box.id = "acctBox"; box.className = "acct-box";
  card.appendChild(box);
  renderPanel();
  const open0 = window.openLogin;
  if (typeof open0 === "function") window.openLogin = function () { const r = open0.apply(this, arguments); if (USER) recentQuestions(USER.uid).then(renderPanel); return r; };
  if (!auth) return;
  getRedirectResult(auth).catch(e => showError(String(e && e.code || e)));
  onAuthStateChanged(auth, async user => {
    USER = user ? { uid: user.uid, name: user.displayName || user.email || "you", photo: user.photoURL || "" } : null;
    window.SMT_USER = USER;
    written.clear();
    if (USER) {
      try {
        await setDoc(doc(db, "users", USER.uid), { name: USER.name.slice(0, 100), lang: ["en", "hi", "bn"].includes(lang()) ? lang() : "en", lastSeen: serverTimestamp() }, { merge: true });
        const merged = S.mergeCalls(typeof loadCalls === "function" ? loadCalls() : [], await pullCalls(USER.uid));
        if (typeof saveCalls === "function") saveCalls(merged);          // → SMT_CALLS_SAVED pushes this browser's new ones
        console.log(`[ACCOUNT] signed in · ${merged.length} call(s) after merging this browser with the account`);
      } catch (e) { console.warn("[ACCOUNT] loading the account failed: " + String(e && e.message || e).slice(0, 160)); }
      renderPanel(await recentQuestions(USER.uid));
    } else renderPanel();
    if (typeof syncPill === "function") syncPill();
    if (typeof renderCalls === "function") renderCalls();
  });
}
install();
console.log(`[ACCOUNT] ready · auth=${auth ? "on" : "off"} · firestore=${db ? "on" : "off"}`);
