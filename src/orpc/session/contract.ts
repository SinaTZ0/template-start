import { oc } from "@orpc/contract";
import { Schema } from "effect";

import { standardSchema } from "#/lib/schema";
import { commonErrors } from "#/orpc/errors";

/*===== Schemas =====*/
/** The signed-in person, as pages see them. Visitors are `null`, not a viewer. */
const ViewerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.String,
});

export type Viewer = typeof ViewerSchema.Type;

/*===== Procedures =====*/
// Public: a visitor gets `null`, not `UNAUTHORIZED`, so no `authErrors`.
export const viewerContract = oc.errors(commonErrors).output(standardSchema(Schema.NullOr(ViewerSchema)));

export const sessionContract = {
  viewer: viewerContract,
};
