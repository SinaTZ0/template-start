import type { ReactNode } from "react";

/*===== Page Message =====*/

/**
 * A page that has only something to say: the address points nowhere, or the page broke. `children` are the ways on
 * (a link home, a retry), so nobody is left at a dead end. It brings no `<main>`: inside the site's layout the layout
 * has it, and the root's error screens wrap it in their own.
 */
export function PageMessage({ title, details, children }: { title: string; details: string; children?: ReactNode }) {
  return (
    <section className="mx-auto flex max-w-site flex-col items-start gap-4 px-4 py-20 sm:px-6">
      <h1 className="text-h1">{title}</h1>
      <p className="max-w-xl text-body-lg text-muted-foreground">{details}</p>
      {children && <div className="mt-2 flex flex-wrap gap-3">{children}</div>}
    </section>
  );
}
