import { m } from "#/paraglide/messages";

/*===== Site Footer =====*/

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto max-w-site px-4 py-6 text-caption text-muted-foreground sm:px-6">
        <p>{m.site_name()}</p>
      </div>
    </footer>
  );
}
