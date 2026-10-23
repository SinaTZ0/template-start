# SEO and Link Previews

Every page sets its tags through `pageMeta` (`src/lib/seo.ts`), so search results and link previews (Telegram,
WhatsApp, X) come out the same everywhere. The site's name and description are the `site_name` and `site_description`
messages, and the rest of its identity lives in `src/lib/site.ts`; rename both per project.

## Page Meta

Return `pageMeta` from the route's `head` option. It returns `{ meta, links }` (the canonical URL is a `<link>`):

```ts
// A public page
head: (args) => pageMeta({ args, title: m.about_title(), description: m.about_description() }),

// A page behind a sign-in, or sign-in itself
head: (args) => pageMeta({ args, title: m.notes_title(), index: false }),
```

| Option        | Default                    | Notes                                                                                               |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `title`       | none (the site name alone) | The page's own name; shown as «title \| site». Leave it out only on the home page.                  |
| `description` | `m.site_description()`     | One or two sentences on what the page offers, a message. Write one for each public page.            |
| `image`       | `SITE_IMAGE`               | `{ url, alt }`, root-relative or absolute, 1200×630, with its `alt` a message.                      |
| `index`       | `true`                     | `false` adds `noindex` and leaves out the canonical URL and preview tags.                           |
| `path`        | current path, no query     | The canonical path, without a locale prefix. Pass one when the query string is part of the content. |

Put `head` after `beforeLoad` and `loader` in the route options. TypeScript infers the options in order, and `head`'s
`args` carry the route's context and loader data; written before them, the types can loop back on themselves and
fail (`beforeLoad` typed as returning `never`).

Title, description and `alt` are messages, called in `head`, so each locale's page gets its own.

A public page gets a title, description, canonical URL, Open Graph tags and a Twitter card, plus the language tags
([i18n.md](./i18n.md) → SEO):

- The canonical URL and `og:url` are the page in the current locale (`/en/notes` for English).
- `og:locale` is the current locale (`fa_IR`, `en_US`, from `OG_LOCALE` in `src/lib/locale.ts`), with
  `og:locale:alternate` for the others.
- `<link rel="alternate" hreflang>` for every locale, and `x-default` for the base locale.

The `<html>` element's `lang` and `dir` follow the locale (`__root.tsx`).

The router merges the `head` of every matched route, and for the same title or `name`/`property` tag the deepest route
wins. The root sets no title, so a page with no `head` has none. Give every page one.

## What to Index

- **Index:** public pages people should find: home, content pages (articles, products), about, contact.
- **`index: false`:** sign-in and sign-up, every page under a guarded layout (`notes_layout`), search and filter
  results, and anything personal. These pages also stay out of the sitemap.
- Don't block private pages in `robots.txt`. A blocked page can't be crawled, so its `noindex` is never read, and the
  file would publish its path.

## Page-Specific Tags

Spread `pageMeta`'s result and add to it. `absoluteUrl` builds any URL from the site's public origin, and `jsonLd`
turns structured data into a `<script type="application/ld+json">` for `scripts`. The home page does this:

```ts
head: (args) => ({
  ...pageMeta({ args }),
  scripts: [
    jsonLd({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: m.site_name(),
      url: absoluteUrl({ matches: args.matches, path: localizeHref("/") }),
    }),
  ],
}),
```

A content page uses the schema.org type for what it shows (`Article`, `Product`, `Event`). Its `head` reads the loader's
data (`args.loaderData`) for its title, description and image, so that loader returns the record (from
`ensureQueryData`) as well as caching it. Check it with Google's Rich Results Test.

## Sitemap and robots.txt

- `/sitemap.xml` (`src/routes/sitemap/`) lists the pages to index, once per locale, each with `xhtml:link` alternates
  for the others. Add each new public page to `STATIC_ENTRIES`, with its plain path.
  Content pages add one entry per published item, read through the oRPC `client` (`src/orpc/client.ts`) from a
  procedure that returns only published items, with `lastModified` set to each item's update time. One sitemap holds
  up to 50,000 URLs.
- `/robots.txt` (`src/routes/robots/`) lets crawlers in everywhere except `/api/` and `/rpc/`, and points them at the
  sitemap.

## The Public Origin

Absolute URLs come from `BETTER_AUTH_URL` (`src/lib/site.server.ts`), which is `https://${DOMAIN}` in production. The
request's host isn't used, because a proxy or a crafted `Host` header can change it. The root loader (the `site.origin` procedure, loaded
once) hands the origin to the browser for `pageMeta`. A staging copy on another domain therefore points its canonical URLs at itself. Keep staging
out of search results by putting it behind a password, or with a `Disallow: /` robots file there.
