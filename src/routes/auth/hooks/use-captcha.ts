// Types `<altcha-widget>` in JSX.
/// <reference types="altcha/types/react" />

import type { AltchaWidgetElement } from "altcha/types/generic";
import { useEffect, useRef } from "react";

import { client } from "#/orpc/client";

/*===== Captcha =====*/
/**
 * Drives an invisible `<altcha-widget>`: on demand it fetches a signed challenge from `captcha.createChallenge`,
 * solves it in the browser and returns the payload for the `x-altcha` header (`auth.server.ts` verifies it).
 *
 * The widget is a custom element that touches `window` when defined, so it is loaded after hydration.
 *
 * @returns `widgetRef` for `<altcha-widget display="invisible">`, and `solve`, which resolves to the payload or null.
 */
export function useCaptcha() {
  const widgetRef = useRef<AltchaWidgetElement>(null);

  useEffect(() => {
    void import("altcha");
  }, []);

  async function solve(): Promise<string | null> {
    const widget = widgetRef.current;
    if (!widget || !customElements.get("altcha-widget")) return null;

    const challenge = await client.captcha.createChallenge();
    await widget.configure({ challenge });
    const result = await widget.verify();
    return result?.payload ?? null;
  }

  return { widgetRef, solve };
}
