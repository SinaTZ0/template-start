import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "#/components/primitive/button/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "#/components/primitive/field/field";
import { Input } from "#/components/primitive/input/input";
import { Spinner } from "#/components/primitive/spinner/spinner";
import { Textarea } from "#/components/primitive/textarea/textarea";
import { FormAlert } from "#/components/shared/form-alert/form-alert";
import { describeApiFailure } from "#/lib/api-error";
import { orpc } from "#/orpc/client";
import type { Media } from "#/orpc/media/contract";
import { m } from "#/paraglide/messages";
import { ImagePicker } from "#/routes/notes/components/image-picker";
import { noteFormSchema, type NoteFormValues } from "#/routes/notes/schema";

/*===== Note Form =====*/
/** Creates a note. Server field errors land next to their inputs; anything else goes to the form alert. */
export function NoteForm({ onCreated }: { onCreated: () => void }) {
  const [image, setImage] = useState<Media | null>(null);
  const form = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: { title: "", body: "" },
  });
  const { errors } = form.formState;

  const create = useMutation(
    orpc.note.create.mutationOptions({
      onSuccess: () => {
        form.reset();
        setImage(null);
        onCreated();
      },
    }),
  );
  const failure = create.error ? describeApiFailure({ error: create.error, fallback: m.notes_save_failed() }) : null;

  const onSubmit = form.handleSubmit((values) => create.mutate({ ...values, imageMediaId: image?.id }));

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormAlert message={failure?.message ?? undefined} />

        <Field data-invalid={!!(errors.title ?? failure?.fields.title) || undefined}>
          <FieldLabel htmlFor="note-title">{m.notes_title_label()}</FieldLabel>
          <Input id="note-title" aria-invalid={!!errors.title} {...form.register("title")} />
          <FieldError>{errors.title?.message ?? failure?.fields.title}</FieldError>
        </Field>

        <Field data-invalid={!!(errors.body ?? failure?.fields.body) || undefined}>
          <FieldLabel htmlFor="note-body">{m.notes_body_label()}</FieldLabel>
          <Textarea id="note-body" rows={4} aria-invalid={!!errors.body} {...form.register("body")} />
          <FieldError>{errors.body?.message ?? failure?.fields.body}</FieldError>
        </Field>

        <ImagePicker value={image} onChange={setImage} serverError={failure?.fields.imageMediaId} />

        <Button type="submit" className="self-start" disabled={create.isPending}>
          {create.isPending && <Spinner data-icon="inline-start" />}
          {m.notes_submit()}
        </Button>
      </FieldGroup>
    </form>
  );
}
