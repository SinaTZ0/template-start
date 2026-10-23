import { cn } from "cn";
import { Loader2Icon } from "lucide-react";
import type { ComponentProps } from "react";
import { spinnerClasses } from "./spinner.styles";

/*===== Spinner =====*/

function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      // An SVG icon, not a live output value, so `<output>` doesn't fit.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="status"
      aria-label="در حال بارگذاری"
      className={cn(spinnerClasses, className)}
      {...props}
    />
  );
}

export { Spinner };
