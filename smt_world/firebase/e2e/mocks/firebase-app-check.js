// E2E stand-in for gstatic firebase-app-check.js — records that App Check was switched on.
export class ReCaptchaEnterpriseProvider { constructor(key) { this.key = key; } }
export function initializeAppCheck(app, opts) { window.__appcheck = opts.provider.key; return { app }; }
export async function getToken() { return { token: "e2e.appcheck.token" }; }
