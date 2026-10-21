import { CappedMap, createChallenge, randomInt } from "altcha-lib";
import type { Challenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { deriveHmacKeySecret, verify } from "altcha-lib/frameworks/shared";

import { env } from "~/env.server";

/*===== Config =====*/
// PBKDF2 is bundled with the browser widget, so no extra worker setup is needed on the client.
const ALGORITHM = "PBKDF2/SHA-256";
// Work = iterations per attempt × attempts (the secret counter). These settings solve in about a
// second in the browser; the original 5,000 × 5,000–10,000 took ~15s on one thread.
const COST = 1_000;
const MIN_COUNTER = 2_000;
const MAX_COUNTER = 5_000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

// Remembers solved challenge ids so one payload can't be replayed for many sign-ups.
// In-memory and per process: enough for a single-instance demo, use a shared store when scaling out.
const usedChallenges = new CappedMap<string, boolean>({ maxSize: 10_000 });

// Derived once: the key-signature secret is a pure function of the master key.
const hmacKeySecretPromise = deriveHmacKeySecret(env.ALTCHA_HMAC_KEY);

/*===== Challenge =====*/
/**
 * Creates a signed, expiring proof-of-work challenge for the Altcha widget.
 *
 * Deterministic mode (`counter`) lets the server verify with a single key derivation instead of
 * repeating the client's search.
 */
export async function createAltchaChallenge(): Promise<Challenge> {
  return createChallenge({
    algorithm: ALGORITHM,
    cost: COST,
    counter: randomInt(MIN_COUNTER, MAX_COUNTER),
    deriveKey,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    hmacSignatureSecret: env.ALTCHA_HMAC_KEY,
    hmacKeySignatureSecret: await hmacKeySecretPromise,
  });
}

/*===== Verification =====*/
/**
 * Verifies the base64 payload the widget produces after solving a challenge.
 *
 * Checks the signature, expiry, and solution, then marks the challenge as used.
 *
 * @returns `true` only for a valid, unexpired, first-time payload. Never throws for bad input.
 */
export async function verifyAltchaPayload(payload: string | null | undefined): Promise<boolean> {
  const { error } = await verify(payload, deriveKey, env.ALTCHA_HMAC_KEY, await hmacKeySecretPromise, usedChallenges);
  return error === null;
}
