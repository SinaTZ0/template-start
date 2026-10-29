import { useEffect, useRef, useState } from "react";

import { useCaptcha } from "#/hooks/use-captcha";

/*===== Captcha Check =====*/

// A solve usually takes about a second; past this the check says why it is slow.
const SLOW_AFTER_MS = 3000;

/** Where a visible «I'm not a robot» check is: not started, solving, solved, or failed. */
export type CaptchaCheckState = "idle" | "solving" | "verified" | "error";

// The server lets a challenge live 10 minutes (`altcha.server.ts`). An answer is dropped a minute earlier, so one never
// expires on its way there. Timed on this device from the moment it was solved, so a wrong clock doesn't matter.
const FRESH_FOR_MS = 9 * 60_000;

/**
 * Drives a visible captcha check on top of `useCaptcha`, for a public form whose procedure uses `captchaMiddleware`.
 * `start` solves a challenge in the background (call it on the form's first focus, so the answer is usually ready by
 * the time the visitor sends); `take` hands the answer to a submission, waiting for a solve still in progress instead
 * of starting over. `state` and `slow` are for drawing the check beside the submit button.
 *
 * An answer works once and expires, so `take` consumes it. After a failed submission call `start` again for a fresh
 * one; after a successful one call `reset` before the form shows again.
 */
export function useCaptchaCheck() {
  const { widgetRef, solve } = useCaptcha();
  const [state, setState] = useState<CaptchaCheckState>("idle");
  const [slow, setSlow] = useState(false);
  const answer = useRef<string | null>(null);
  const running = useRef<Promise<string | null>>(null);
  const expiry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const slowTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      clearTimeout(expiry.current);
      clearTimeout(slowTimer.current);
    },
    [],
  );

  function forget() {
    clearTimeout(expiry.current);
    answer.current = null;
  }

  /** Solves a challenge unless an answer is ready or on its way. Resolves to the answer, or null when it failed. */
  function start(): Promise<string | null> {
    if (answer.current) return Promise.resolve(answer.current);
    if (running.current) return running.current;

    setState("solving");
    setSlow(false);
    slowTimer.current = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const run = solve()
      .catch(() => null)
      .then((payload) => {
        clearTimeout(slowTimer.current);
        running.current = null;
        answer.current = payload;
        setState(payload ? "verified" : "error");
        if (payload) {
          expiry.current = setTimeout(() => {
            answer.current = null;
            setState("idle");
          }, FRESH_FOR_MS);
        }
        return payload;
      });
    running.current = run;
    return run;
  }

  /** The answer for one submission: the ready one, the one being solved, or a new one. Null when solving failed. */
  async function take(): Promise<string | null> {
    const payload = await start();
    // The check keeps showing «verified» while the form sends; a failed send asks for a new answer with `start`.
    forget();
    return payload;
  }

  /** Back to not started, for a form shown again after a successful submission. */
  function reset() {
    forget();
    setState("idle");
  }

  // `slow`: the solve has run past SLOW_AFTER_MS, as it can on an older phone.
  return { widgetRef, state, slow, start, take, reset };
}

export type CaptchaCheck = ReturnType<typeof useCaptchaCheck>;
