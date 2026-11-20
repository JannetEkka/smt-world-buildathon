// SECURITY RULES, tested in Google's Firestore EMULATOR (not a reading of the file):
//   cd smt_world/firebase && npx firebase emulators:exec --only firestore --project demo-smt \
//        "node --test test/rules.emulator.mjs"
// Needs Java + firebase-tools + @firebase/rules-unit-testing (CI installs them).
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const { initializeTestEnvironment, assertSucceeds, assertFails } = req("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, addDoc, collection, updateDoc, serverTimestamp, getDocs } = req("firebase/firestore");

const RULES = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "firestore.rules"), "utf8");
let env;
test.before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
  env = await initializeTestEnvironment({ projectId: "demo-smt", firestore: { rules: RULES, host, port: Number(port) } });
});
test.after(async () => { await env?.cleanup(); });
test.beforeEach(async () => { await env.clearFirestore(); });

const call = (o = {}) => ({ coin: "ADA", dir: "UP", t0: 1763600000, due: 1763614400, smt: "UP", smtWhy: null, smtConv: 41, ...o });
const priya = () => env.authenticatedContext("priya").firestore();
const ravi = () => env.authenticatedContext("ravi").firestore();
const guest = () => env.unauthenticatedContext().firestore();

test("a user can write and read her own profile, calls and questions", async () => {
  const db = priya();
  await assertSucceeds(setDoc(doc(db, "users/priya"), { name: "Priya", lang: "bn", lastSeen: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, "users/priya/calls/ADA@1763600000"), call()));
  await assertSucceeds(setDoc(doc(db, "users/priya/calls/ADA@1763600000"), call({ graded: true, move: 1.25, px0: 0.15, px1: 0.152, gsrc: "Binance", you: "right", smtOut: "right" })));
  await assertSucceeds(addDoc(collection(db, "users/priya/questions"), { q: "তুমি ADA কেন ধরে আছ?", lang: "bn", outcome: "answered", layer: null, at: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(db, "users/priya/calls/ADA@1763600000")));
  await assertSucceeds(getDocs(collection(db, "users/priya/questions")));
});

test("nobody else can read or write her data — not another user, not a visitor who isn't signed in", async () => {
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "users/priya/calls/ADA@1763600000"), call()); });
  for (const db of [ravi(), guest()]) {
    await assertFails(getDoc(doc(db, "users/priya/calls/ADA@1763600000")));
    await assertFails(getDocs(collection(db, "users/priya/questions")));
    await assertFails(setDoc(doc(db, "users/priya/calls/BTC@1763600001"), call({ coin: "BTC", t0: 1763600001 })));
    await assertFails(setDoc(doc(db, "users/priya"), { name: "hacked" }));
  }
});

test("a call must be one of the 8 coins, UP or DOWN, with only the app's fields, stored under its own id", async () => {
  const db = priya();
  await assertFails(setDoc(doc(db, "users/priya/calls/PEPE@1763600000"), call({ coin: "PEPE" })));
  await assertFails(setDoc(doc(db, "users/priya/calls/ADA@1763600000"), call({ dir: "SIDEWAYS" })));
  await assertFails(setDoc(doc(db, "users/priya/calls/ADA@1763600000"), call({ isAdmin: true })));
  await assertFails(setDoc(doc(db, "users/priya/calls/ADA@1763600000"), call({ t0: "1763600000" })));
  await assertFails(setDoc(doc(db, "users/priya/calls/BTC@1"), call()));
});

test("a question is capped, typed, stamped by the server, and can never be edited afterwards", async () => {
  const db = priya();
  await assertFails(addDoc(collection(db, "users/priya/questions"), { q: "x".repeat(501), lang: "en", outcome: "answered", layer: null, at: serverTimestamp() }));
  await assertFails(addDoc(collection(db, "users/priya/questions"), { q: "hi", lang: "fr", outcome: "answered", layer: null, at: serverTimestamp() }));
  await assertFails(addDoc(collection(db, "users/priya/questions"), { q: "hi", lang: "en", outcome: "answered", layer: null, at: new Date(0) }));
  await assertFails(addDoc(collection(db, "users/priya/questions"), { q: "hi", lang: "en", outcome: "answered", layer: null, at: serverTimestamp(), extra: 1 }));
  const ref = await addDoc(collection(db, "users/priya/questions"), { q: "hi", lang: "en", outcome: "refused", layer: "rule", at: serverTimestamp() });
  await assertFails(updateDoc(ref, { q: "edited" }));
});

test("a profile takes only name, language and a server time; anything outside /users is closed", async () => {
  const db = priya();
  await assertFails(setDoc(doc(db, "users/priya"), { name: "Priya", role: "admin" }));
  await assertFails(setDoc(doc(db, "users/priya"), { name: "x".repeat(101) }));
  await assertFails(setDoc(doc(db, "feed/latest"), { anything: 1 }));
  await assertFails(getDoc(doc(db, "feed/latest")));
});
