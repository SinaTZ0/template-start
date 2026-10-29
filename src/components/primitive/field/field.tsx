import { type VariantProps } from "class-variance-authority";
import { cn } from "#/lib/utils";
import { CircleAlertIcon } from "lucide-react";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import { Label } from "../label/label";
import { Separator } from "../separator/separator";
import {
  fieldContentClasses,
  fieldDescriptionClasses,
  fieldErrorClasses,
  fieldErrorListClasses,
  fieldGroupClasses,
  fieldLabelClasses,
  fieldLegendVariants,
  fieldSeparatorClasses,
  fieldSeparatorContentClasses,
  fieldSetClasses,
  fieldTitleClasses,
  fieldVariants,
} from "./field.styles";

/*===== Set and Group =====*/

function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset data-slot="field-set" className={cn(fieldSetClasses, className)} {...props} />;
}

export type FieldLegendProps = ComponentProps<"legend"> & VariantProps<typeof fieldLegendVariants>;

function FieldLegend({ className, variant = "legend", ...props }: FieldLegendProps) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(fieldLegendVariants({ variant }), className)}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn(fieldGroupClasses, className)} {...props} />;
}

/*===== Field =====*/

export type FieldProps = ComponentProps<"div"> & VariantProps<typeof fieldVariants>;

/**
 * Groups a control with its label, description and error.
 * Set `data-invalid` to colour the whole field, and `data-disabled` to dim its label.
 */
function Field({ className, orientation = "vertical", ...props }: FieldProps) {
  return (
    <div
      // A fieldset would add form-grouping semantics and UA styles; FieldSet covers that case.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

/*===== Compound Parts =====*/

function FieldContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-content" className={cn(fieldContentClasses, className)} {...props} />;
}

function FieldLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={cn(fieldLabelClasses, className)} {...props} />;
}

function FieldTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-label" className={cn(fieldTitleClasses, className)} {...props} />;
}

function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn(fieldDescriptionClasses, className)} {...props} />;
}

function FieldSeparator({ children, className, ...props }: ComponentProps<"div"> & { children?: ReactNode }) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(fieldSeparatorClasses, className)}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span className={fieldSeparatorContentClasses} data-slot="field-separator-content">
          {children}
        </span>
      )}
    </div>
  );
}

/*===== Error =====*/

export type FieldErrorProps = ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>;
};

/**
 * Shows `children`, or else the messages in `errors` with duplicates removed: one message as text,
 * several as a list. Renders nothing when there is nothing to show.
 */
function FieldError({ className, children, errors, ...props }: FieldErrorProps) {
  const content = useMemo(() => {
    if (children) return children;
    if (!errors?.length) return null;

    const uniqueErrors = [...new Map(errors.map((error) => [error?.message, error])).values()];

    if (uniqueErrors.length === 1) return uniqueErrors[0]?.message;

    return (
      <ul className={fieldErrorListClasses}>
        {uniqueErrors.map((error, index) => error?.message && <li key={index}>{error.message}</li>)}
      </ul>
    );
  }, [children, errors]);

  if (!content) return null;

  return (
    <div role="alert" data-slot="field-error" className={cn(fieldErrorClasses, className)} {...props}>
      {/* Never show an error by colour alone. */}
      <CircleAlertIcon aria-hidden="true" />
      <div>{content}</div>
    </div>
  );
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
};
