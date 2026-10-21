import { os } from "@orpc/server";

import { span } from "~/lib/trace.server";

/*===== Procedure Tracing Middleware =====*/
/**
 * Times every procedure as a `procedure` span of the current request (e.g. `note.list`), whether it is called over
 * HTTP or from a loader through the server client.
 *
 * Applied first on the implementer, so the span covers input validation and error handling too.
 */
export const traceProcedureMiddleware = os.middleware(async ({ next, path }) =>
  span({ kind: "procedure", name: path.join(".") }, async () => next()),
);
