import { ORPCError, os, ValidationError } from "@orpc/server";

import { createLogger } from "~/lib/logger.server";
import { issuesToErrorData } from "~/lib/schema-issues";

const log = createLogger("orpc");

/*===== Global Error Middleware =====*/
/**
 * Normalizes every failure into the shared error shape (`~/orpc/errors`).
 *
 * - Input validation failures become `INVALID_INPUT` with per-field messages.
 * - Client errors thrown on purpose (`UNAUTHORIZED`, `INVALID_INPUT`, …) pass through unchanged.
 * - Everything else, including output validation failures, becomes a generic
 *   `INTERNAL_SERVER_ERROR` whose `errorId` points at the full error in the server log.
 *
 * Applied on the implementer so it also wraps contract validation.
 */
export const handleErrorsMiddleware = os.middleware(async ({ next, path }) => {
  try {
    // `await` keeps async failures inside this `try`.
    return await next();
  } catch (error) {
    /*------ Input Validation ------*/
    if (error instanceof ORPCError && error.code === "BAD_REQUEST" && error.cause instanceof ValidationError) {
      throw new ORPCError("INVALID_INPUT", {
        message: "Invalid input.",
        data: issuesToErrorData(error.cause.issues),
        cause: error,
      });
    }

    /*------ Intentional Client Errors ------*/
    if (error instanceof ORPCError && error.code !== "INTERNAL_SERVER_ERROR") throw error;

    /*------ Unexpected Failures ------*/
    const errorId = crypto.randomUUID();
    log.error({ err: error, errorId, path: path.join(".") }, "procedure failed");
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Internal server error.",
      data: { errors: [], fields: {}, errorId },
      cause: error,
    });
  }
});
