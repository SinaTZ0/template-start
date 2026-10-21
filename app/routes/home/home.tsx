import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { buttonVariants } from "~/components/primitive/button/button.styles";
import { absoluteUrl, jsonLd, pageMeta } from "~/lib/seo";
import { SITE_NAME } from "~/lib/site";

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/")({
  // A public page: the full set of tags, plus structured data that tells search engines the site's name.
  head: (args) => ({
    ...pageMeta({ args }),
    scripts: [
      jsonLd({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: absoluteUrl({ matches: args.matches, path: "/" }),
      }),
    ],
  }),
  component: Home,
});

/*===== Home =====*/
function Home() {
  return (
    <section className="mx-auto flex max-w-site flex-col items-start gap-6 px-4 py-20 sm:px-6">
      <h1 className="text-display">{SITE_NAME}</h1>
      <p className="max-w-xl text-body-lg text-muted-foreground">
        این صفحه را با معرفی پروژه جایگزین کنید. بخش یادداشت‌ها نمونه‌ای کامل از ورود، API و بارگذاری عکس است.
      </p>
      <Link to="/notes" className={buttonVariants({ variant: "highlight", size: "lg" })}>
        رفتن به یادداشت‌ها
        <ArrowLeftIcon data-icon="inline-end" />
      </Link>
    </section>
  );
}
