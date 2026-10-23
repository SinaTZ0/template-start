import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { buttonVariants } from "#/components/primitive/button/button.styles";
import { absoluteUrl, jsonLd, pageMeta } from "#/lib/seo";
import { m } from "#/paraglide/messages";
import { localizeHref } from "#/paraglide/runtime";

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/")({
  // A public page: the full set of tags, plus structured data that tells search engines the site's name.
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
  component: Home,
});

/*===== Home =====*/
function Home() {
  return (
    <section className="mx-auto flex max-w-site flex-col items-start gap-6 px-4 py-20 sm:px-6">
      <h1 className="text-display">{m.site_name()}</h1>
      <p className="max-w-xl text-body-lg text-muted-foreground">{m.home_intro()}</p>
      <Link to="/notes" className={buttonVariants({ variant: "highlight", size: "lg" })}>
        {m.home_go_to_notes()}
        {/* Points forward: left in Persian, flipped to point right in English. */}
        <ArrowLeftIcon data-icon="inline-end" className="ltr:-scale-x-100" />
      </Link>
    </section>
  );
}
