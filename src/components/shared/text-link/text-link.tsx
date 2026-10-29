import { type VariantProps } from "class-variance-authority";
import { cn } from "#/lib/utils";
import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SiteLink } from "#/components/shared/site-link/site-link";
import { textLinkArrowClasses, textLinkVariants } from "./text-link.styles";

/*===== Text Link =====*/

export type TextLinkProps = VariantProps<typeof textLinkVariants> & {
  /** Omit inside a link card: the text link then renders as a `<span>` call that reacts to the card's hover. */
  href?: string;
  children: ReactNode;
  className?: string;
};

/**
 * A forward text link: a `brand-text` label and a trailing `arrow-left` that nudges ahead on hover and focus, such as
 * «همه اطلاعیه‌ها» or «بیشتر بخوانید».
 */
export function TextLink({ href, tone, className, children }: TextLinkProps) {
  const classes = cn(textLinkVariants({ tone }), className);
  const content = (
    <>
      {children}
      <ArrowLeftIcon aria-hidden className={textLinkArrowClasses} />
    </>
  );

  if (href === undefined) {
    return (
      <span data-slot="text-link" className={classes}>
        {content}
      </span>
    );
  }

  return (
    <SiteLink data-slot="text-link" href={href} className={classes}>
      {content}
    </SiteLink>
  );
}
