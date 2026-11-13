import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { NotebookPenIcon } from "lucide-react";

import { buttonVariants } from "#/components/primitive/button/button.styles";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/primitive/card/card";
import { NoteForm } from "#/components/shared/note-form/note-form";
import { pageMeta } from "#/lib/seo";
import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";
import { NoteCard } from "#/routes/notes/components/note-card";
import { NoteStats } from "#/routes/notes/components/note-stats";
import { notesSearchSchema } from "#/routes/notes/search-params";

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/_notes-layout/notes")({
  validateSearch: notesSearchSchema,
  // The one param the loader reads: a new cursor reruns it and keys the page's query.
  loaderDeps: ({ search }) => ({ cursor: search.before }),
  // Fills the Query cache on the server, on preload and on navigation; the page reads the same queries.
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(orpc.note.list.queryOptions({ input: deps })),
      // Admins only, as the procedure is: asking for anyone else would fail the page with `FORBIDDEN`.
      context.viewer.role === "admin" && context.queryClient.ensureQueryData(orpc.note.stats.queryOptions()),
    ]);
  },
  // Behind a sign-in, so search engines shouldn't list it.
  head: (args) => pageMeta({ args, title: m.notes_title(), index: false }),
  component: NotesPage,
});

/*===== Page =====*/
function NotesPage() {
  const { viewer } = Route.useRouteContext();
  const { before } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: page } = useSuspenseQuery(orpc.note.list.queryOptions({ input: { cursor: before } }));
  const queryClient = useQueryClient();
  // Creating or deleting a note changes every page of the list and the admin's numbers, so all of the feature's
  // queries. The promise settles once the ones on screen have been read again.
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.note.key() });

  return (
    <div className="mx-auto grid max-w-site gap-8 px-4 py-10 sm:px-6 lg:flex">
      {/*===== New Note =====*/}
      <Card className="self-start lg:w-88 lg:shrink-0">
        <CardHeader>
          <CardTitle>
            <h1 className="text-h3">{m.notes_new_heading({ name: viewer.name })}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NoteForm
            onSaved={async () => {
              await refresh();
              // A new note is the newest, so it shows on the first page: go there from an older one.
              if (before) await navigate({ search: {} });
            }}
          />
        </CardContent>
      </Card>

      {/*===== List =====*/}
      <section aria-label={m.notes_list_label()} className="grid min-w-0 flex-1 content-start gap-5">
        {viewer.role === "admin" && <NoteStats />}

        {page.notes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center text-muted-foreground">
            <NotebookPenIcon className="size-8" />
            {/* An older page can empty out when its notes are deleted; that isn't "no notes yet". */}
            <p>{before ? m.notes_empty_page() : m.notes_empty()}</p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2">
            {page.notes.map((note) => (
              <li key={note.id}>
                <NoteCard note={note} onDeleted={refresh} />
              </li>
            ))}
          </ul>
        )}

        {/*------ Pages ------*/}
        {(before || page.nextCursor) && (
          <nav aria-label={m.notes_pages_label()} className="flex justify-between gap-3">
            {before ? (
              <Link to="/notes" className={buttonVariants({ variant: "outline" })}>
                {m.notes_newest()}
              </Link>
            ) : (
              <span />
            )}
            {page.nextCursor && (
              <Link to="/notes" search={{ before: page.nextCursor }} className={buttonVariants({ variant: "outline" })}>
                {m.notes_older()}
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
