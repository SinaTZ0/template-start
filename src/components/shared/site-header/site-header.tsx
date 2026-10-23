import { Link } from "@tanstack/react-router";
import { LogOutIcon, UserIcon } from "lucide-react";

import { Button } from "#/components/primitive/button/button";
import { buttonVariants } from "#/components/primitive/button/button.styles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/primitive/dropdown-menu/dropdown-menu";
import { LocaleSwitcher } from "#/components/shared/locale-switcher/locale-switcher";
import { ThemeToggle } from "#/components/shared/theme-toggle/theme-toggle";
import { useLocaleLinks } from "#/hooks/use-locale-links";
import { useSignOut } from "#/hooks/use-sign-out";
import type { Viewer } from "#/lib/viewer";
import { m } from "#/paraglide/messages";

/*===== Navigation =====*/

// Message functions, not their text: called in render, so each request gets its own locale's labels.
const NAV_ITEMS = [
  { label: m.nav_home, to: "/" },
  { label: m.nav_notes, to: "/notes" },
] as const;

// The current page gets the primary underline; hover and focus tint the text.
const navItemClasses =
  "relative inline-flex h-16 items-center px-3 text-nav text-muted-foreground outline-none transition-colors duration-150 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-[current=page]:text-foreground aria-[current=page]:after:opacity-100 motion-reduce:transition-none";

/*===== Account =====*/

function AccountMenu({ viewer }: { viewer: Viewer }) {
  const signOut = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={m.nav_account()} />}>
        <UserIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block text-foreground">{viewer.name}</span>
            <span dir="ltr" className="block text-start">
              {viewer.email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          <LogOutIcon />
          {m.nav_sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/*===== Site Header =====*/

/** Brand, main navigation, language switcher, theme toggle and the account menu (or a sign-in button for visitors). */
export function SiteHeader({ viewer }: { viewer: Viewer | null }) {
  const localeLinks = useLocaleLinks();

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-16 max-w-site items-center gap-4 px-4 sm:px-6">
        <Link
          to="/"
          className="rounded-sm text-h4 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
        >
          {m.site_name()}
        </Link>

        <nav aria-label={m.nav_main()} className="flex items-center">
          {NAV_ITEMS.map((item) => (
            // The active link gets `aria-current="page"`, which the classes style. `exact` keeps "/" from matching
            // every page.
            <Link key={item.to} to={item.to} activeOptions={{ exact: true }} className={navItemClasses}>
              {item.label()}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1">
          <LocaleSwitcher links={localeLinks} />
          <ThemeToggle />
          {viewer ? (
            <AccountMenu viewer={viewer} />
          ) : (
            // A link styled as a button: `<Button render={<Link />}>` would announce it as a button (`role="button"`).
            <Link to="/auth" className={buttonVariants({ size: "sm" })}>
              {m.nav_sign_in()}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
