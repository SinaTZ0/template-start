import type { Location, MetaDescriptor } from "react-router";

import { pageTitle, SITE_DESCRIPTION, SITE_IMAGE, SITE_LOCALE, SITE_NAME } from "~/lib/site";

/*===== Types =====*/
// What `pageMeta` needs from a route's `meta` arguments. Every `Route.MetaArgs` fits.
type MetaArgsLike = {
  location: Location;
  matches: ReadonlyArray<{ id: string; loaderData: unknown } | undefined>;
};

/*===== Absolute URLs =====*/
/**
 * Turns a root-relative path into an absolute URL on the site's public origin, which the root loader provides
 * (`root.tsx`). Canonical URLs and Open Graph tags need absolute URLs. If the root loader has no data (it failed), the
 * path is returned as it is.
 */
export function absoluteUrl({ matches, path }: { matches: MetaArgsLike["matches"]; path: string }): string {
  const root = matches.find((match) => match?.id === "root")?.loaderData as { origin?: string } | undefined;
  return root?.origin ? new URL(path, root.origin).href : path;
}

/*===== Page Meta =====*/
/**
 * The `meta` tags for a page: title, description, canonical URL, Open Graph and Twitter link previews, and `robots`.
 * Return it from a route's `meta` export, adding page-specific tags after it (`docs/frontend/seo.md`).
 *
 * @param title The page's own title, shown as «title | site». Leave it out on the home page.
 * @param description What the page offers, in one or two Persian sentences. Defaults to `SITE_DESCRIPTION`.
 * @param image The link-preview image, root-relative or absolute. Defaults to `SITE_IMAGE`.
 * @param index `false` for pages search engines shouldn't list: sign-in, anything behind a sign-in, and private
 * results. They get `noindex` and no canonical URL, and stay out of the sitemap.
 * @param path The canonical path. Defaults to the current path without its query string, so filtered or paged views
 * point at the page itself. Pass one when the query is part of the content.
 */
export function pageMeta({
  args: { location, matches },
  title,
  description = SITE_DESCRIPTION,
  image = SITE_IMAGE,
  index = true,
  path = location.pathname,
}: {
  args: MetaArgsLike;
  title?: string;
  description?: string;
  image?: { url: string; alt: string } | null;
  index?: boolean;
  path?: string;
}): MetaDescriptor[] {
  const fullTitle = pageTitle(title);

  /*------ Private Pages ------*/
  // Nothing to preview: a link to them leads to the sign-in page anyway.
  if (!index) {
    return [
      { title: fullTitle },
      { name: "description", content: description },
      { name: "robots", content: "noindex" },
    ];
  }

  /*------ Public Pages ------*/
  const url = absoluteUrl({ matches, path });
  const tags: MetaDescriptor[] = [
    { title: fullTitle },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: SITE_LOCALE },
    { property: "og:title", content: title ?? SITE_NAME },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    // Twitter reads the title, description and image from the Open Graph tags; it only needs the card size.
    { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
  ];

  if (image) {
    tags.push(
      { property: "og:image", content: absoluteUrl({ matches, path: image.url }) },
      { property: "og:image:alt", content: image.alt },
    );
  }

  return tags;
}
