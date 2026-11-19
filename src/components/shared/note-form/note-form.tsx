import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "#/components/primitive/button/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "#/components/primitive/field/field";
import { Input } from "#/components/primitive/input/input";
import { Spinner } from "#/components/primitive/spinner/spinner";
import { Textarea } from "#/components/primitive/textarea/textarea";
import { FormAlert } from "#/components/shared/form-alert/form-alert";
import { ImagePicker } from "#/components/shared/note-form/image-picker";
import { noteFormSchema, type NoteFormValues } from "#/components/shared/note-form/note-form.schema";
import { describeApiFailure } from "#/lib/api-error";
import { client } from "#/orpc/client";
import type { Media } from "#/orpc/media/contract";
import type { Note } from "#/orpc/note/contract";
import { m } from "#/paraglide/messages";

/*===== Note Form =====*/
/**
 * Creates a note, or changes `note` when one is given. Shared because the list page creates with it and the note's
 * own page edits with it. Server field errors land next to their inputs; anything else goes to the form alert.
 *
 * @param onSaved Called with the saved note: the page invalidates the queries the save changed and returns that
 * promise, so the button stays busy until the page shows the change.
 */
export function NoteForm({ note, onSaved }: { note?: Note; onSaved: (saved: Note) => Promise<unknown> }) {
  const id = useId();
  const [image, setImage] = useState<Media | null>(note?.image ?? null);
  const form = useForm<NoteFormValues>({
    resolver: standardSchemaResolver(noteFormSchema),
    defaultValues: { title: note?.title ?? "", body: note?.body ?? "" },
  });

  const save = useMutation({
    mutationFn: (values: NoteFormValues) => {
      const fields = { ...values, imageMediaId: image?.id };
      return note ? client.note.update({ id: note.id, ...fields }) : client.note.create(fields);
    },
    onSuccess: async (saved) => {
      await onSaved(saved);
      // A new note leaves an empty form for the next one; an edited one keeps showing what was saved.
      if (!note) {
        form.reset();
        setImage(null);
      }
    },
  });
  const failure = save.error ? describeApiFailure({ error: save.error, fallback: m.notes_save_failed() }) : null;

  /*------ Errors ------*/
  // The form's own check first, then what the server said about the same field.
  const titleError = form.formState.errors.title?.message ?? failure?.fields.title;
  const bodyError = form.formState.errors.body?.message ?? failure?.fields.body;
  const titleErrorId = `${id}-title-error`;
  const bodyErrorId = `${id}-body-error`;

  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
      <FieldGroup>
        <FormAlert message={failure?.message ?? undefined} />

        <Field data-invalid={!!titleError || undefined}>
          <FieldLabel htmlFor={`${id}-title`}>{m.notes_title_label()}</FieldLabel>
          <Input
            id={`${id}-title`}
            // Both say why the input is marked: `aria-invalid` alone leaves a screen reader without the reason.
            aria-invalid={!!titleError}
            aria-describedby={titleError ? titleErrorId : undefined}
            {...form.register("title")}
          />
          <FieldError id={titleErrorId}>{titleError}</FieldError>
        </Field>

        <Field data-invalid={!!bodyError || undefined}>
          <FieldLabel htmlFor={`${id}-body`}>{m.notes_body_label()}</FieldLabel>
          <Textarea
            id={`${id}-body`}
            rows={4}
            aria-invalid={!!bodyError}
            aria-describedby={bodyError ? bodyErrorId : undefined}
            {...form.register("body")}
          />
          <FieldError id={bodyErrorId}>{bodyError}</FieldError>
        </Field>

        <ImagePicker value={image} onChange={setImage} serverError={failure?.fields.imageMediaId} />

        <Button type="submit" className="self-start" disabled={save.isPending}>
          {save.isPending && <Spinner data-icon="inline-start" />}
          {note ? m.notes_save() : m.notes_submit()}
        </Button>
      </FieldGroup>
    </form>
  );
}
