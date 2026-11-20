import { CappedMap, createChallenge, randomInt } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { deriveHmacKeySecret, verify } from "altcha-lib/frameworks/shared";
import { Context, DateTime, Effect, Layer, Redacted } from "effect";

import type { AltchaChallenge } from "#/orpc/captcha/contract";
import { AppConfig } from "#/server/config.server";
import { CaptchaFailed } from "#/server/errors";

/*===== Settings =====*/
// PBKDF2 is bundled with the browser widget, so no extra worker setup is needed on the client.
const ALGORITHM = "PBKDF2/SHA-256";
// Work = iterations per attempt × attempts (the secret counter). These settings solve in about a second in the browser;
// the original 5,000 × 5,000–10,000 took ~15 s on one thread.
const COST = 1_000;
const MIN_COUNTER = 2_000;
const MAX_COUNTER = 5_000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/*===== Captcha =====*/
/**
 * Altcha proof of work: the only thing between a public form and a script that fills its table. Challenges are signed
 * and expire, so the server stores none; solved ones are remembered so one solution is worth one call.
 */
export class Captcha extends Context.Service<
  Captcha,
  {
    /** A fresh challenge for the browser to solve. Public: anyone about to submit a public form needs one. */
    readonly issue: Effect.Effect<AltchaChallenge>;
    /**
     * Lets a call through only with a solved challenge. Each payload works once, so a retry needs a fresh solve.
     *
     * @throws `CaptchaFailed` for a missing, invalid, expired or reused payload.
     */
    readonly verify: (payload: string | null | undefined) => Effect.Effect<void, CaptchaFailed>;
  }
>()("app/server/Captcha") {
  static readonly layer = Layer.effect(
    Captcha,
    Effect.gen(function* () {
      const key = Redacted.value((yield* AppConfig).altchaKey);
      // Derived once: the key-signature secret is a pure function of the master key.
      const keySecret = yield* Effect.promise(() => deriveHmacKeySecret(key));
      // In memory and per process: enough for the one app process `compose.prod.yaml` runs. Several would need a
      // shared store, or a solution could be spent once on each.
      const used = new CappedMap<string, boolean>({ maxSize: 10_000 });

      return Captcha.of({
        issue: DateTime.now.pipe(
          Effect.map((now) => DateTime.toDate(DateTime.add(now, { milliseconds: CHALLENGE_TTL_MS }))),
          Effect.flatMap((expiresAt) =>
            Effect.promise(() =>
              createChallenge({
                algorithm: ALGORITHM,
                cost: COST,
                // Deterministic mode lets the server verify with one key derivation instead of repeating the search.
                counter: randomInt(MIN_COUNTER, MAX_COUNTER),
                deriveKey,
                expiresAt,
                hmacSignatureSecret: key,
                hmacKeySignatureSecret: keySecret,
              }),
            ),
          ),
          Effect.withSpan("Captcha.issue"),
        ),
        verify: (payload) =>
          Effect.promise(() => verify(payload, deriveKey, key, keySecret, used)).pipe(
            Effect.flatMap(({ error }) => (error === null ? Effect.void : Effect.fail(new CaptchaFailed()))),
            Effect.withSpan("Captcha.verify"),
          ),
      });
    }),
  );
}
