import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertDescription } from "~/components/primitive/alert/alert";

/*===== Form Alert =====*/
/**
 * Form-level error message, for failures that don't belong to a single field (wrong credentials,
 * network errors, server errors). Renders nothing without a message. `role="alert"` announces it.
 */
export function FormAlert({ message }: { message: string | undefined }) {
  if (!message) return null;

  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
