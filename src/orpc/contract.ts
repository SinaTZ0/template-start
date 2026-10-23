import { captchaContract } from "#/orpc/captcha/contract";
import { mediaContract } from "#/orpc/media/contract";
import { noteContract } from "#/orpc/note/contract";
import { sessionContract } from "#/orpc/session/contract";
import { siteContract } from "#/orpc/site/contract";

/*===== API Contract =====*/
// Source of truth for the API. The browser client is typed from this, never from the router.
export const contract = {
  captcha: captchaContract,
  media: mediaContract,
  note: noteContract,
  session: sessionContract,
  site: siteContract,
};
