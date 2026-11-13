import { Link } from "@tanstack/react-router";

import { buttonVariants } from "#/components/primitive/button/button.styles";
import { PageMessage } from "#/components/shared/page-message/page-message";
import { m } from "#/paraglide/messages";

/*===== Not Found Page =====*/

/**
 * What a missing page shows inside the site's layout, with a way home. A route's `notFoundComponent` is drawn in place
 * of that route's own component, so this goes on the page route, never on the layout (which would lose its header and
 * footer): the catch-all (`src/routes/not_found/`) has it, and so does every page whose loader can throw `notFound()`
 * (`orNotFound`, `src/lib/not-found.ts`).
 */
export function NotFoundPage() {
  return (
    <PageMessage title={m.root_not_found_title()} details={m.root_not_found_details()}>
      <Link to="/" className={buttonVariants({ size: "lg" })}>
        {m.root_go_home()}
      </Link>
    </PageMessage>
  );
}
