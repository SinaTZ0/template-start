import { useMutation } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";

import { Button } from "#/components/primitive/button/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardMedia,
  CardTitle,
} from "#/components/primitive/card/card";
import { toast } from "#/components/primitive/toast/toast";
import { MediaImage } from "#/components/shared/media-image/media-image";
import { describeApiFailure } from "#/lib/api-error";
import { formatDate } from "#/lib/locale";
import { orpc } from "#/orpc/client";
import type { Note } from "#/orpc/note/contract";
import { m } from "#/paraglide/messages";

/*===== Note Card =====*/
export function NoteCard({ note, onDeleted }: { note: Note; onDeleted: () => void }) {
  const remove = useMutation(
    orpc.note.delete.mutationOptions({
      onSuccess: onDeleted,
      onError: (error) => {
        const { message } = describeApiFailure({ error, fallback: m.notes_delete_failed() });
        toast.add({ title: message ?? m.notes_delete_failed(), type: "error" });
      },
    }),
  );

  return (
    <Card>
      {note.image && (
        <CardMedia className="aspect-4/3">
          <MediaImage media={note.image} variant="card" alt={note.title} />
        </CardMedia>
      )}
      <CardHeader>
        <CardTitle>{note.title}</CardTitle>
        <CardDescription>{formatDate(note.createdAt)}</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.notes_delete_label({ title: note.title })}
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: note.id })}
          >
            <Trash2Icon />
          </Button>
        </CardAction>
      </CardHeader>
      {note.body && <CardContent className="whitespace-pre-line">{note.body}</CardContent>}
    </Card>
  );
}
