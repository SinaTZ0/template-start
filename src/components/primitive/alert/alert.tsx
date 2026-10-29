import { type VariantProps } from "class-variance-authority";
import { cn } from "#/lib/utils";
import type { ComponentProps } from "react";
import { alertActionClasses, alertDescriptionClasses, alertTitleClasses, alertVariants } from "./alert.styles";

/*===== Alert =====*/

export type AlertProps = ComponentProps<"div"> & VariantProps<typeof alertVariants>;

/**
 * An inline notice. A leading `svg` child becomes its icon column. Warnings and errors interrupt with
 * `role="alert"`; the other tones are announced politely with `role="status"`. Pass `role` to override.
 */
function Alert({ className, variant, ...props }: AlertProps) {
  const role = variant === "warning" || variant === "destructive" ? "alert" : "status";

  return <div data-slot="alert" role={role} className={cn(alertVariants({ variant }), className)} {...props} />;
}

/*===== Compound Parts =====*/

function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn(alertTitleClasses, className)} {...props} />;
}

function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn(alertDescriptionClasses, className)} {...props} />;
}

function AlertAction({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-action" className={cn(alertActionClasses, className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
