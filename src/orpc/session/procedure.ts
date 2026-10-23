import { getRequestSession } from "#/lib/auth.server";
import { base } from "#/orpc/implementer.server";
import { resolveViewer } from "#/orpc/session/service";

/*===== Viewer =====*/
export const viewerProcedure = base.session.viewer.handler(async ({ context }) => {
  const session = await getRequestSession(context.headers);
  return resolveViewer({ user: session?.user ?? null });
});
