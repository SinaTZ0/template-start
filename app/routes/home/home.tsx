import { ArrowLeftIcon } from "lucide-react";
import { Link } from "react-router";

import { buttonVariants } from "~/components/primitive/button/button.styles";
import { SITE_NAME, pageTitle } from "~/lib/site";

import type { Route } from "./+types/home";

/*===== Meta =====*/
export const meta: Route.MetaFunction = () => [
  { title: pageTitle() },
  { name: "description", content: "نقطه شروع پروژه‌های تازه." },
];

/*===== Home =====*/
export default function Home() {
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
