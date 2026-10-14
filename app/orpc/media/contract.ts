import { oc } from "@orpc/contract";
import { z } from "zod";

import { commonErrors } from "~/orpc/errors";
import { MEDIA_KINDS } from "~/orpc/media/constants";
import { authErrors, roleErrors } from "~/orpc/middleware/auth/auth.errors";

/*===== Schemas =====*/
/** What clients get for an uploaded image: enough to render any variant without further requests. */
export const mediaSchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  /** Of the original after rotation, for the `inside` variants' aspect ratio. */
  width: z.number().int(),
  height: z.number().int(),
  /** Data URI of a 16 px wide WebP, shown blurred while the image loads. */
  placeholder: z.string(),
  /** Public URL per variant name (`thumb`, `card`, ...). Which names exist depends on the kind. */
  urls: z.record(z.string(), z.string()),
});

export type Media = z.infer<typeof mediaSchema>;

// Structure only. The size, the real image format and the pixel count are checked by the processing.
const uploadMediaInputSchema = z.strictObject({
  kind: z.enum(MEDIA_KINDS),
  file: z.file(),
});

/*===== Procedures =====*/
export const uploadMediaContract = oc
  .errors({ ...commonErrors, ...authErrors, ...roleErrors })
  .input(uploadMediaInputSchema)
  .output(mediaSchema);

export const mediaContract = {
  upload: uploadMediaContract,
};
