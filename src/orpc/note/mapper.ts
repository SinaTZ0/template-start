import { toPublicMedia } from "#/orpc/media/mapper";
import type { Note } from "#/orpc/note/contract";
import type { NoteWithImage } from "#/orpc/note/repository";

/*===== Public Note =====*/
/**
 * Converts a stored note into its public shape: drops `ownerId` and turns the image row into public URLs under
 * `mediaPublicUrl` (`AppConfig.mediaPublicUrl`).
 */
export function toPublicNote({ note, image }: NoteWithImage, mediaPublicUrl: string): Note {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    image: image ? toPublicMedia({ record: image, publicUrl: mediaPublicUrl }) : null,
    createdAt: note.createdAt,
  };
}
