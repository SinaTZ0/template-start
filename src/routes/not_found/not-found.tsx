import { createFileRoute, notFound } from "@tanstack/react-router";

import { NotFoundPage } from "#/components/shared/not-found-page/not-found-page";
import { pageMeta } from "#/lib/seo";
import { m } from "#/paraglide/messages";

/*===== Route =====*/
// Every address no other route answers. Nothing lives here: the loader answers with a real 404 status, and the page is
// drawn in the site layout's `<Outlet />`, between the header and the footer.
export const Route = createFileRoute("/_site-layout/$")({
  loader: () => {
    throw notFound();
  },
  head: (args) => pageMeta({ args, title: m.root_not_found_title(), index: false }),
  notFoundComponent: NotFoundPage,
});
