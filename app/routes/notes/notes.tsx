import { NotebookPenIcon } from "lucide-react";
import { useRevalidator } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/primitive/card/card";
import { sessionContext } from "~/lib/session-guard.server";
import { pageTitle } from "~/lib/site";
import { createServerClient } from "~/orpc/server-client.server";
import { NoteCard } from "~/routes/notes/components/note-card";
import { NoteForm } from "~/routes/notes/components/note-form";

import type { Route } from "./+types/notes";

/*===== Meta =====*/
export const meta: Route.MetaFunction = () => [{ title: pageTitle("یادداشت‌ها") }];

/*===== Loader =====*/
// Render-critical data comes from the loader through the in-process client; mutations go through the browser client
// and revalidate it.
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = context.get(sessionContext);
  const notes = await createServerClient(request).note.list();
  return { notes, userName: session.user.name };
}

/*===== Page =====*/
export default function NotesPage({ loaderData }: Route.ComponentProps) {
  const { notes, userName } = loaderData;
  const revalidator = useRevalidator();
  const refresh = () => void revalidator.revalidate();

  return (
    <div className="mx-auto grid max-w-site gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[22rem_1fr]">
      {/*===== New Note =====*/}
      <Card className="self-start">
        <CardHeader>
          <CardTitle>
            <h1 className="text-h3">یادداشت تازه، {userName}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NoteForm onCreated={refresh} />
        </CardContent>
      </Card>

      {/*===== List =====*/}
      <section aria-label="یادداشت‌های شما">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center text-muted-foreground">
            <NotebookPenIcon className="size-8" />
            <p>هنوز یادداشتی ندارید. اولین یادداشت را از فرم کنار بسازید.</p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2">
            {notes.map((note) => (
              <li key={note.id}>
                <NoteCard note={note} onDeleted={refresh} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
