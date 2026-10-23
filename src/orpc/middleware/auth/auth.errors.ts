import { errorDataSchema } from "#/orpc/errors";

/*===== Auth Errors =====*/
// Browser-safe: declared on every contract whose procedure uses `requireUserMiddleware`.
export const authErrors = {
  UNAUTHORIZED: {
    message: "Sign in to continue.",
    data: errorDataSchema,
  },
};

/*===== Role Errors =====*/
// Declared, together with `authErrors`, on every contract whose procedure uses `requireRoleMiddleware`.
export const roleErrors = {
  FORBIDDEN: {
    message: "Your account can't do this.",
    data: errorDataSchema,
  },
};
