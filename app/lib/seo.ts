import type { AnyRouteMatch } from "@tanstack/react-router";

import { pageTitle, SITE_DESCRIPTION, SITE_IMAGE, SITE_LOCALE, SITE_NAME } from "~/lib/site";

/*===== Types =====*/
// What `pageMeta` needs from a route's `head` arguments. Every route's `head` context fits.
type HeadArgsLike = {
  match: { pathname: string };
  matches: ReadonlyArray<Pick<AnyRouteMatch, "routeId" | "loaderData">>;
};

// The tag props a route's `head` returns.
type MetaTag = NonNullable<NonNullable<AnyRouteMatch["meta"]>[number]>;
type LinkTag = NonNullable<NonNullable<AnyRouteMatch["links"]>[number]>;
type ScriptTag = NonNullable<NonNullable<AnyRouteMatch["headScripts"]>[number]>;

type HeadTags = { meta: MetaTag[]; links: LinkTag[] };

/*===== Absolute URLs =====*/
/**
 * Turns a root-relative path into an absolute URL on the site's public origin, which the root loader provides
 * (`root.tsx`). Canonical URLs and Open Graph tags need absolute URLs. If the root loader has no data (it failed), the
 * path is returned as it is.
 */
export function absoluteUrl({ matches, path }: { matches: HeadArgsLike["matches"]; path: string }): string {
  const root = matches.find((match) => match.routeId === "__root__")?.loaderData as { origin?: string } | undefined;
  return root?.origin ? new URL(path, root.origin).href : path;
}

/*===== Page Meta =====*/
/**
 * The head tags for a page: title, description, canonical URL, Open Graph and Twitter link previews, and `robots`.
 * Return it from a route's `head` option, adding page-specific tags to its lists (`docs/frontend/seo.md`).
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
  args: { match, matches },
  title,
  description = SITE_DESCRIPTION,
  image = SITE_IMAGE,
  index = true,
  path = match.pathname,
}: {
  args: HeadArgsLike;
  title?: string;
  description?: string;
  image?: { url: string; alt: string } | null;
  index?: boolean;
  path?: string;
}): HeadTags {
  const fullTitle = pageTitle(title);

  /*------ Private Pages ------*/
  // Nothing to preview: a link to them leads to the sign-in page anyway.
  if (!index) {
    return {
      meta: [
        { title: fullTitle },
        { name: "description", content: description },
        { name: "robots", content: "noindex" },
      ],
      links: [],
    };
  }

  /*------ Public Pages ------*/
  const url = absoluteUrl({ matches, path });
  const meta: MetaTag[] = [
    { title: fullTitle },
    { name: "description", content: description },
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
    meta.push(
      { property: "og:image", content: absoluteUrl({ matches, path: image.url }) },
      { property: "og:image:alt", content: image.alt },
    );
  }

  return { meta, links: [{ rel: "canonical", href: url }] };
}

/*===== Structured Data =====*/
/** A JSON-LD `<script>` for a route's `head` `scripts`, e.g. schema.org `WebSite` or `Article` data. */
export function jsonLd(data: Record<string, unknown>): ScriptTag {
  // `<` is escaped so a value holding `</script>` can't end the tag early.
  return { type: "application/ld+json", children: JSON.stringify(data).replaceAll("<", "\\u003c") };
}
