import { expect, layer } from "@effect/vitest";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { Effect, Layer } from "effect";

import { Captcha } from "#/server/captcha.server";
import { AppConfig } from "#/server/config.server";
import { CaptchaFailed } from "#/server/errors";

/*===== Captcha =====*/
// The only thing between a public form and a script that fills its table: a call must carry a solved challenge, and
// one solution must not be worth more than one call.

/** A solved challenge, as the browser sends it. */
const solve = Effect.gen(function* () {
  const captcha = yield* Captcha;
  const challenge = yield* captcha.issue;
  const solution = yield* Effect.promise(() => solveChallenge({ challenge, deriveKey }));
  if (!solution) return yield* Effect.die(new Error("the challenge wasn't solved"));
  return btoa(JSON.stringify({ challenge, solution }));
});

/** The check's failure, or `undefined` when it lets the call through. */
const failureOf = (payload: string) =>
  Captcha.use((captcha) => captcha.verify(payload)).pipe(
    Effect.flip,
    Effect.orElseSucceed(() => undefined),
  );

// One layer for the block, as the app has one: the solutions already used are the service's own memory. On the real
// clock (`excludeTestServices`), since a challenge expires by it.
layer(Captcha.layer.pipe(Layer.provide(AppConfig.layer)), { excludeTestServices: true })("Captcha.verify", (it) => {
  it.effect("lets a solved challenge through once", () =>
    Effect.gen(function* () {
      const captcha = yield* solve;

      expect(yield* failureOf(captcha)).toBeUndefined();
      expect(yield* failureOf(captcha)).toBeInstanceOf(CaptchaFailed);
    }),
  );

  it.effect("turns away a call without a solution", () =>
    Effect.gen(function* () {
      expect(yield* failureOf("")).toBeInstanceOf(CaptchaFailed);
    }),
  );
});
