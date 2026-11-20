// E2E stand-in for gstatic firebase-ai.js. Behaviour is steered by window.__mock (set by the
// test); every call is recorded in window.__calls as {step, model} so a test can prove which
// layers ran. It returns schema-shaped JSON exactly like the real structured-output calls.
export class GoogleAIBackend {}
export const ResponseModality = { AUDIO: "AUDIO", TEXT: "TEXT" };
export const getAI = () => ({});
export const Schema = { object: p => ({ type: "object", ...p }), string: p => ({ type: "string", ...(p || {}) }),
  enumString: p => ({ type: "string", ...p }), array: p => ({ type: "array", ...p }) };
window.__calls = [];
const M = () => window.__mock || {};
const usage = { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 };
const reply = o => ({ response: { usageMetadata: usage, text: () => typeof o === "string" ? o : JSON.stringify(o) } });
export function getGenerativeModel(ai, params) {
  return { async generateContent(req) {
    await new Promise(r => setTimeout(r, 50));
    // window.__mock.fail = {model: "500" | "cut"}: the two failures seen live on 11-20
    const f = (M().fail || {})[params.model];
    if (f === "500") { window.__calls.push({ step: "failed", model: params.model }); throw new Error(`AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/x/models/${params.model}:generateContent: [500 Internal Server Error]`); }
    if (f === "cut") { window.__calls.push({ step: "failed", model: params.model }); return reply('{"refuse":"none","answer":"I hold ADA on pa'); }
    const sch = params.generationConfig && params.generationConfig.responseSchema;
    const isAudio = Array.isArray(req) && req.some(p => p && p.inlineData);
    if (isAudio) {
      window.__calls.push({ step: "transcribe", model: params.model, mime: req[0].inlineData.mimeType, bytes: req[0].inlineData.data.length });
      return reply({ transcript: M().say || "Why are you holding ADA?", language: "en" });
    }
    if (sch && sch.properties && sch.properties.category) {
      window.__calls.push({ step: "guard", model: params.model, prompt: String(req) });
      return reply({ category: M().guard || "safe", why: "e2e" });
    }
    if (!sch) { window.__calls.push({ step: "chat", model: params.model }); return reply("plain tutorial reply"); }
    const ids = sch.properties.points.items.properties.fact.enum;
    window.__calls.push({ step: "answer", model: params.model, ids });
    if (M().answer === "refuse") return reply({ refuse: "advice", answer: "no", points: [] });
    if (M().answer === "bad") return reply({ refuse: "none", answer: "You should buy ADA now, it is cheap.", points: [] });
    const want = ids.filter(i => /^ADA\.p0\.(position|rule|record|exit)$|^ADA\.adv\.flows$/.test(i));
    return reply({ refuse: "none", answer: "I hold ADA on paper because a written rule fired. It has a tested record and exits by its own rule.",
      points: want.map(f => ({ fact: f, says: "says " + f })).concat([{ fact: "ADA.p9.invented", says: "INVENTED REASON" }]) });
  } };
}
export function getLiveGenerativeModel(ai, params) {
  window.__live = { model: params.model, transcription: !!params.generationConfig.outputAudioTranscription };
  return { async connect() {
    if (M().liveFail) throw new Error("e2e: Live API unavailable");
    let text = null;
    return { async sendTextRealtime(t) { text = t; window.__spokenText = t; }, async close() {},
      async *receive() {
        while (text == null) await new Promise(r => setTimeout(r, 10));
        const pcm = new Int16Array(2400); for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 5) * 3000;
        yield { type: "serverContent", modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: btoa(String.fromCharCode(...new Uint8Array(pcm.buffer))) } }] },
                outputTranscription: { text } };
        yield { type: "serverContent", turnComplete: true };
      } };
  } };
}
