import { cn } from "cn";
import type { ComponentProps } from "react";
import { labelClasses } from "./label.styles";

/*===== Label =====*/

function Label({ className, ...props }: ComponentProps<"label">) {
  // Callers associate the control through `htmlFor` or by nesting it in `children`.
  // oxlint-disable-next-line jsx-a11y/label-has-associated-control
  return <label data-slot="label" className={cn(labelClasses, className)} {...props} />;
}

export { Label };
