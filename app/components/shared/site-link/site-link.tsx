import type { ComponentProps } from "react";
import { Link } from "react-router";

/*===== Site Link =====*/

export type SiteLinkProps = Omit<ComponentProps<"a">, "href"> & { href: string };

/**
 * One link for content data that mixes this app's pages and outside destinations. Paths starting with `/` go through
 * the router; `http(s)` links open in a new tab without leaking the opener; `mailto:` and `tel:` stay plain anchors.
 */
export function SiteLink({ href, children, ...props }: SiteLinkProps) {
  if (href.startsWith("/")) {
    return (
      <Link to={href} {...props}>
        {children}
      </Link>
    );
  }

  const isWeb = href.startsWith("http");
  return (
    <a href={href} {...(isWeb ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...props}>
      {children}
    </a>
  );
}
