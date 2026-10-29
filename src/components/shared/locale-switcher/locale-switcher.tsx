import type { ButtonProps } from "#/components/primitive/button/button";
import { buttonVariants } from "#/components/primitive/button/button.styles";
import type { LocaleLink } from "#/hooks/use-locale-links";
import { m } from "#/paraglide/messages";

/*===== Locale Switcher =====*/
/**
 * Links to the current page in the other languages (`useLocaleLinks`). Plain links that load the page again: the new
 * language's `lang`, `dir` and every message then come from the server, with nothing to re-render, and they work
 * without JavaScript. Each name is in its own language and marked as such. Renders nothing with one locale.
 */
export function LocaleSwitcher({
  links,
  variant = "ghost",
  className,
}: {
  links: LocaleLink[];
  /** The links' button look: `ghost` by default, another variant where the header's surface needs one. */
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  if (links.length === 0) return null;

  return (
    <nav aria-label={m.common_language()} className={className}>
      <ul className="flex items-center">
        {links.map((link) => (
          <li key={link.locale}>
            <a
              href={link.href}
              hrefLang={link.locale}
              lang={link.locale}
              className={buttonVariants({ variant, size: "sm" })}
            >
              {link.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
