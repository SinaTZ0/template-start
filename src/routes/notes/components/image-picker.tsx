import { useMutation } from "@tanstack/react-query";
import { ImageIcon, XIcon } from "lucide-react";
import { useId, useRef } from "react";

import { Button } from "#/components/primitive/button/button";
import { Field, FieldError, FieldLabel } from "#/components/primitive/field/field";
import { Spinner } from "#/components/primitive/spinner/spinner";
import { MediaImage } from "#/components/shared/media-image/media-image";
import { describeApiFailure } from "#/lib/api-error";
import { orpc } from "#/orpc/client";
import { MEDIA_ACCEPTED_TYPES } from "#/orpc/media/constants";
import type { Media } from "#/orpc/media/contract";

/*===== Image Picker =====*/
/**
 * Uploads the picked file right away (`media.upload`, kind `image`) and shows its preview. The parent keeps the
 * returned media and sends its ID when the form is saved, which attaches it.
 */
export function ImagePicker({
  value,
  onChange,
  serverError,
}: {
  value: Media | null;
  onChange: (media: Media | null) => void;
  serverError?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMutation(orpc.media.upload.mutationOptions({ onSuccess: onChange }));
  const failure = upload.error
    ? describeApiFailure({ error: upload.error, fallback: "بارگذاری عکس انجام نشد." })
    : null;
  const error = failure?.fields.file ?? failure?.message ?? serverError;

  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={inputId}>عکس (اختیاری)</FieldLabel>

      {value ? (
        <div className="relative w-40">
          <MediaImage media={value} variant="thumb" alt="پیش‌نمایش عکس" className="w-40 rounded-md" />
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            aria-label="حذف عکس"
            className="absolute end-1 top-1"
            onClick={() => onChange(null)}
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {upload.isPending ? <Spinner data-icon="inline-start" /> : <ImageIcon data-icon="inline-start" />}
          انتخاب عکس
        </Button>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={MEDIA_ACCEPTED_TYPES}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) upload.mutate({ kind: "image", file });
        }}
      />
      <FieldError>{error}</FieldError>
    </Field>
  );
}
