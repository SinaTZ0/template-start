import { type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps } from "react";
import { Button, type ButtonProps } from "#/components/primitive/button/button";
import { Input } from "#/components/primitive/input/input";
import { Textarea } from "#/components/primitive/textarea/textarea";
import {
  inputGroupAddonVariants,
  inputGroupButtonVariants,
  inputGroupClasses,
  inputGroupInputClasses,
  inputGroupTextareaClasses,
  inputGroupTextClasses,
} from "./input-group.styles";

/*===== Input Group =====*/

export type InputGroupAddonProps = ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>;
export type InputGroupButtonProps = Omit<ButtonProps, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset";
  };

/** A field frame that holds one control plus addons; it draws focus and invalid states for the control. */
function InputGroup({ className, ...props }: ComponentProps<"div">) {
  // A fieldset would add form-grouping semantics and UA styles; this only groups one control with its addons.
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
  return <div data-slot="input-group" role="group" {...props} className={cn(inputGroupClasses, className)} />;
}

/*===== Addons =====*/

/**
 * Places icons, text, or buttons beside or around the control.
 * Clicking the addon (but not a button inside it) focuses the group's input, like clicking a label.
 */
function InputGroupAddon({ className, align = "inline-start", ...props }: InputGroupAddonProps) {
  // The click handler is a pointer convenience; keyboard users already tab straight to the input.
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return;
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
      {...props}
    />
  );
}

/** A compact Button sized for addons; defaults to `type="button"` so it never submits the form by accident. */
function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: InputGroupButtonProps) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cn(inputGroupTextClasses, className)} />;
}

/*===== Controls =====*/

function InputGroupInput({ className, ...props }: ComponentProps<"input">) {
  return <Input data-slot="input-group-control" {...props} className={cn(inputGroupInputClasses, className)} />;
}

function InputGroupTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return <Textarea data-slot="input-group-control" {...props} className={cn(inputGroupTextareaClasses, className)} />;
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea };
