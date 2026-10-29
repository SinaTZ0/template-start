import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { type VariantProps } from "class-variance-authority";
import { cn } from "#/lib/utils";
import type { ComponentProps } from "react";
import { buttonVariants } from "./button.styles";

/*===== Button =====*/

export type ButtonProps = ComponentProps<typeof ButtonPrimitive> & VariantProps<typeof buttonVariants>;

/**
 * Styles Base UI's button while preserving its refs, rendering, and interaction behavior.
 * Use `variant`/`size` for the button's look and `className` for consumer layout; a function
 * `className` still receives Base UI state. Icon-only sizes need an accessible name via `aria-label`.
 */
function Button({ className, variant, size, ...props }: ButtonProps) {
  const classes = buttonVariants({ variant, size });

  return (
    <ButtonPrimitive
      data-slot="button"
      {...props}
      className={typeof className === "function" ? (state) => cn(classes, className(state)) : cn(classes, className)}
    />
  );
}

export { Button };
