// SMT World — microphone audio → 16 kHz mono 16-bit WAV (11-20, buildathon).
// Chrome's MediaRecorder writes WebM/Opus, which is not on Gemini's list of audio types
// (WAV, MP3, AIFF, AAC, OGG, FLAC); WAV is, and the browser can make it with no library.
// Pure: tested by smt_world/firebase/test/wav.test.mjs.

// Average-down resample (the mic runs at 44.1/48 kHz; speech needs 16 kHz).
export function downsample(samples, fromRate, toRate = 16000) {
  if (toRate >= fromRate) return Float32Array.from(samples);
  const ratio = fromRate / toRate, n = Math.floor(samples.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += samples[j];
    out[i] = b > a ? s / (b - a) : 0;
  }
  return out;
}

export function encodeWav(samples, rate = 16000) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64");
}

// Live API audio out: base64 16-bit little-endian PCM → Float32 for an AudioBuffer.
export function pcm16ToFloat(b64) {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const n = bin.length >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (x >= 0x8000) x -= 0x10000;
    out[i] = x / 0x8000;
  }
  return out;
}

export const rms = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length || 1)); };
