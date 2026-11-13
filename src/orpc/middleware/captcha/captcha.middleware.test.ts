import { createRouterClient, os } from "@orpc/server";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createAltchaChallenge } from "#/lib/altcha.server";
import { captchaMiddleware } from "#/orpc/middleware/captcha/captcha.middleware";

/*===== Captcha Middleware =====*/
// The only thing between a public form and a script that fills its table: a call must carry a solved challenge, and
// one solution must not be worth more than one call.

const client = createRouterClient(
  os
    .input(z.object({ captcha: z.string() }))
    .use(captchaMiddleware)
    .handler(() => "saved"),
);

async function solve(): Promise<string> {
  const challenge = await createAltchaChallenge();
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error("the challenge wasn't solved");
  return btoa(JSON.stringify({ challenge, solution }));
}

describe("captchaMiddleware", () => {
  it("lets a solved challenge through once", async () => {
    const captcha = await solve();

    await expect(client({ captcha })).resolves.toBe("saved");
    await expect(client({ captcha })).rejects.toMatchObject({ code: "CAPTCHA_FAILED" });
  });

  it("turns away a call without a solution", async () => {
    await expect(client({ captcha: "" })).rejects.toMatchObject({ code: "CAPTCHA_FAILED" });
  });
});
