import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import { m } from "#/paraglide/messages";

/*===== Site Link =====*/

export type SiteLinkProps = Omit<ComponentProps<"a">, "href"> & { href: string };

/**
 * One link for content data that mixes this app's pages and outside destinations. Paths starting with `/` go through
 * the router, a query (`/notes?page=2`) becoming the route's search params and a fragment its `hash`; `http(s)` links
 * open in a new tab without leaking the opener, and say so to screen readers; `mailto:` and `tel:` stay plain anchors.
 */
export function SiteLink({ href, children, ...props }: SiteLinkProps) {
  if (href.startsWith("/")) {
    // The router matches `to` against its routes, so a query or fragment left in it would match no route.
    const [rest, hash] = href.split("#", 2);
    const [path, query] = rest.split("?", 2);
    return (
      <Link
        to={path}
        search={query ? Object.fromEntries(new URLSearchParams(query)) : undefined}
        hash={hash}
        {...props}
      >
        {children}
      </Link>
    );
  }

  const isWeb = href.startsWith("http");
  return (
    <a href={href} {...(isWeb ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...props}>
      {children}
      {isWeb && <span className="sr-only"> {m.common_new_tab()}</span>}
    </a>
  );
}
