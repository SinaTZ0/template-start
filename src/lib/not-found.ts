import { ORPCError } from "@orpc/client";
import { notFound } from "@tanstack/react-router";

/*===== Not Found =====*/
/**
 * Waits for a loader's read and turns the API's `NOT_FOUND` into the router's `notFound()`, so a missing item renders
 * the route's `notFoundComponent` with a real 404 status instead of the error page:
 * `await orNotFound(context.queryClient.ensureQueryData(orpc.note.get.queryOptions({ input: { id } })))`. Give that
 * route `notFoundComponent: NotFoundPage` (`src/components/shared/not-found-page/`), or the root's bare 404 answers.
 *
 * @throws `notFound()` for `NOT_FOUND`; any other error as it came.
 */
export async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") throw notFound();
    throw error;
  }
}
