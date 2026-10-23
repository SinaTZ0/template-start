/*===== Client ID =====*/
// A random ID per browser, so the error viewer can show one visitor's errors together (docs/backend/logging.md →
// Client ID). It is a cookie rather than local storage so the server's reports carry it too. It is random, not a
// fingerprint of the device: clearing cookies gives a new one, and it says nothing about who the visitor is.

export const CLIENT_ID_COOKIE = "cid";

const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Reads the client ID from a `Cookie` header. Returns `undefined` when it is missing or isn't one this app made. */
export function readClientId(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const [name, value] = pair.trim().split("=");
    if (name === CLIENT_ID_COOKIE && value && CLIENT_ID_PATTERN.test(value)) return value;
  }
  return undefined;
}

/**
 * Returns this browser's client ID, creating the cookie on the first visit. Browser only.
 *
 * Uses `getRandomValues` rather than `randomUUID`, which only exists on HTTPS and localhost.
 */
export function ensureClientId(): string {
  const existing = readClientId(document.cookie);
  if (existing) return existing;

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CLIENT_ID_COOKIE}=${id}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
  return id;
}
