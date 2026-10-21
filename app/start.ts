import { createMiddleware, createStart } from "@tanstack/react-start";

import { span } from "~/lib/trace.server";

/*===== Server Function Timing =====*/
/**
 * Times every server function as a `server-fn` span (`app/lib/trace.server.ts`), so the request log shows how long
 * loaders spent on the server. Procedures and queries a server function starts become its children in the timeline.
 */
const timeServerFunction = createMiddleware({ type: "function" }).server(({ next, serverFnMeta }) =>
  span({ kind: "server-fn", name: serverFnMeta.name }, () => next()),
);

/*===== Start =====*/
export const startInstance = createStart(() => ({
  functionMiddleware: [timeServerFunction],
}));
