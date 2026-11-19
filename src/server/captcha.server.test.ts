import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { Captcha } from "#/server/captcha.server";
import { AppConfig } from "#/server/config.server";
import { CaptchaFailed } from "#/server/errors";

/*===== Captcha =====*/
// The only thing between a public form and a script that fills its table: a call must carry a solved challenge, and
// one solution must not be worth more than one call.

// One runtime, as the app has: the solutions already used are the service's own memory.
const runtime = ManagedRuntime.make(Captcha.layer.pipe(Layer.provide(AppConfig.layer)));
const run = <A, E>(effect: Effect.Effect<A, E, Captcha>) => runtime.runPromise(effect);

afterAll(() => runtime.dispose());

async function solve(): Promise<string> {
  const challenge = await run(Captcha.use((captcha) => captcha.issue));
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error("the challenge wasn't solved");
  return btoa(JSON.stringify({ challenge, solution }));
}

/** The check's failure, or `undefined` when it lets the call through. */
const failureOf = (payload: string) =>
  run(
    Captcha.use((captcha) => captcha.verify(payload)).pipe(
      Effect.flip,
      Effect.orElseSucceed(() => undefined),
    ),
  );

describe("Captcha.verify", () => {
  it("lets a solved challenge through once", async () => {
    const captcha = await solve();

    expect(await failureOf(captcha)).toBeUndefined();
    expect(await failureOf(captcha)).toBeInstanceOf(CaptchaFailed);
  });

  it("turns away a call without a solution", async () => {
    expect(await failureOf("")).toBeInstanceOf(CaptchaFailed);
  });
});
