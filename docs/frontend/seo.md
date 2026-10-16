# SEO and Link Previews

Every page sets its tags through `pageMeta` (`app/lib/seo.ts`), so search results and link previews (Telegram,
WhatsApp, X) come out the same everywhere. The site's identity lives in `app/lib/site.ts`; rename it per project.

## Page Meta

Return `pageMeta` from the route's `meta` export:

```ts
// A public page
export const meta: Route.MetaFunction = (args) =>
  pageMeta({ args, title: "درباره ما", description: "چه کسی هستیم و چه می‌کنیم." });

// A page behind a sign-in, or sign-in itself
export const meta: Route.MetaFunction = (args) => pageMeta({ args, title: "یادداشت‌ها", index: false });
```

| Option        | Default                    | Notes                                                                                 |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `title`       | none (the site name alone) | The page's own name; shown as «title \| site». Leave it out only on the home page.    |
| `description` | `SITE_DESCRIPTION`         | One or two Persian sentences on what the page offers. Write one for each public page. |
| `image`       | `SITE_IMAGE`               | `{ url, alt }`, root-relative or absolute, 1200×630, with a Persian `alt`.            |
| `index`       | `true`                     | `false` adds `noindex` and leaves out the canonical URL and preview tags.             |
| `path`        | current path, no query     | The canonical path. Pass one when the query string is part of the content.            |

A public page gets a title, description, canonical URL, Open Graph tags (`og:locale` is `fa_IR`) and a Twitter card. The
`<html>` element already has `lang="fa"` and `dir="rtl"` (`root.tsx`). The site has one language, so it needs no
`hreflang` alternates.

React Router replaces the parent's meta with the child's instead of merging, so a page with no `meta` export shows no
title. Give every page one.

## What to Index

- **Index:** public pages people should find: home, content pages (articles, products), about, contact.
- **`index: false`:** sign-in and sign-up, every page under a `requireSession` layout, search and filter results, and
  anything personal. These pages also stay out of the sitemap.
- Don't block private pages in `robots.txt`. A blocked page can't be crawled, so its `noindex` is never read, and the
  file would publish its path.

## Page-Specific Tags

Add tags after `pageMeta`'s. `absoluteUrl` builds any URL from the site's public origin. The home page sets structured
data this way:

```ts
export const meta: Route.MetaFunction = (args) => [
  ...pageMeta({ args }),
  {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl({ matches: args.matches, path: "/" }),
    },
  },
];
```

A content page uses the schema.org type for what it shows (`Article`, `Product`, `Event`). Its meta reads the loader's
data (`args.loaderData`) for its title, description and image. Check it with Google's Rich Results Test.

## Sitemap and robots.txt

- `/sitemap.xml` (`app/routes/sitemap/`) lists the pages to index. Add each new public page to `STATIC_ENTRIES`.
  Content pages add one entry per published item from the loader, read through `createServerClient(request)` from a
  procedure that returns only published items, with `lastModified` set to each item's update time. One sitemap holds
  up to 50,000 URLs.
- `/robots.txt` (`app/routes/robots/`) lets crawlers in everywhere except `/api/` and `/rpc/`, and points them at the
  sitemap.

## The Public Origin

Absolute URLs come from `BETTER_AUTH_URL` (`app/lib/site.server.ts`), which is `https://${DOMAIN}` in production. The
request's host isn't used, because a proxy or a crafted `Host` header can change it. The root loader hands the origin to
the browser for `pageMeta`. A staging copy on another domain therefore points its canonical URLs at itself. Keep staging
out of search results by putting it behind a password, or with a `Disallow: /` robots file there.
