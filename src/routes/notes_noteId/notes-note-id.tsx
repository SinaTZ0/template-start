import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { buttonVariants } from "#/components/primitive/button/button.styles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/primitive/card/card";
import { NotFoundPage } from "#/components/shared/not-found-page/not-found-page";
import { NoteForm } from "#/components/shared/note-form/note-form";
import { formatDate } from "#/lib/locale";
import { orNotFound } from "#/lib/not-found";
import { pageMeta } from "#/lib/seo";
import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";

/*===== Route =====*/
export const Route = createFileRoute("/_site-layout/_notes-layout/notes/$noteId")({
  // An unknown ID, or another user's note, is a 404 page rather than the error page.
  loader: ({ context, params }) =>
    orNotFound(context.queryClient.ensureQueryData(orpc.note.get.queryOptions({ input: { id: params.noteId } }))),
  head: (args) => pageMeta({ args, title: m.notes_edit_title(), index: false }),
  component: NotePage,
  notFoundComponent: NotFoundPage,
});

/*===== Page =====*/
function NotePage() {
  const { noteId } = Route.useParams();
  const navigate = Route.useNavigate();
  const { data: note } = useSuspenseQuery(orpc.note.get.queryOptions({ input: { id: noteId } }));
  const queryClient = useQueryClient();

  return (
    <div className="mx-auto grid max-w-xl gap-5 px-4 py-10 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-h3">{m.notes_edit_title()}</h1>
          </CardTitle>
          <CardDescription>{m.notes_edit_created({ date: formatDate(note.createdAt) })}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Keyed by the note: going from one note to another starts the form from that note's values. */}
          <NoteForm
            key={note.id}
            note={note}
            onSaved={async () => {
              // This note's own query and the list's pages that show it.
              await queryClient.invalidateQueries({ queryKey: orpc.note.key() });
              await navigate({ to: "/notes" });
            }}
          />
        </CardContent>
      </Card>

      <Link to="/notes" className={buttonVariants({ variant: "ghost", className: "justify-self-start" })}>
        {m.notes_back()}
      </Link>
    </div>
  );
}
