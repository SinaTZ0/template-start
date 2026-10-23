import { toPublicMedia } from "#/orpc/media/mapper";
import type { Note } from "#/orpc/note/contract";
import type { NoteWithImage } from "#/orpc/note/repository";

/*===== Public Note =====*/
/** Converts a stored note into its public shape: drops `ownerId` and turns the image row into public URLs. */
export function toPublicNote({ note, image }: NoteWithImage): Note {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    image: image ? toPublicMedia(image) : null,
    createdAt: note.createdAt,
  };
}
