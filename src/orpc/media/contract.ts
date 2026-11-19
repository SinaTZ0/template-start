import { oc } from "@orpc/contract";
import { Schema } from "effect";

import { standardSchema } from "#/lib/schema";
import { authErrors, commonErrors, roleErrors } from "#/orpc/errors";
import { MEDIA_KINDS } from "#/orpc/media/constants";

/*===== Schemas =====*/
/** What clients get for an uploaded image: enough to render any variant without further requests. */
export const MediaSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(MEDIA_KINDS),
  /** Of the original after rotation, for the `inside` variants' aspect ratio. */
  width: Schema.Int,
  height: Schema.Int,
  /** Data URI of a 16 px wide WebP, shown blurred while the image loads. */
  placeholder: Schema.String,
  /** Public URL per variant name (`thumb`, `card`, ...). Which names exist depends on the kind. */
  urls: Schema.Record(Schema.String, Schema.String),
});

export type Media = typeof MediaSchema.Type;

// Structure only. The size, the real image format and the pixel count are checked by the processing.
const UploadMediaInput = Schema.Struct({
  kind: Schema.Literals(MEDIA_KINDS),
  file: Schema.File,
});

/*===== Procedures =====*/
export const uploadMediaContract = oc
  .errors({ ...commonErrors, ...authErrors, ...roleErrors })
  .input(standardSchema(UploadMediaInput))
  .output(standardSchema(MediaSchema));

export const mediaContract = {
  upload: uploadMediaContract,
};
