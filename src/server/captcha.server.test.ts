import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createAltchaChallenge } from "#/lib/altcha.server";
import { verifyCaptcha } from "#/server/captcha.server";
import { CaptchaFailed } from "#/server/errors";

/*===== Captcha =====*/
// The only thing between a public form and a script that fills its table: a call must carry a solved challenge, and
// one solution must not be worth more than one call.

async function solve(): Promise<string> {
  const challenge = await createAltchaChallenge();
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error("the challenge wasn't solved");
  return btoa(JSON.stringify({ challenge, solution }));
}

/** The check's failure, or `undefined` when it lets the call through. */
const failureOf = (payload: string) =>
  Effect.runPromise(
    verifyCaptcha(payload).pipe(
      Effect.flip,
      Effect.orElseSucceed(() => undefined),
    ),
  );

describe("verifyCaptcha", () => {
  it("lets a solved challenge through once", async () => {
    const captcha = await solve();

    expect(await failureOf(captcha)).toBeUndefined();
    expect(await failureOf(captcha)).toBeInstanceOf(CaptchaFailed);
  });

  it("turns away a call without a solution", async () => {
    expect(await failureOf("")).toBeInstanceOf(CaptchaFailed);
  });
});
