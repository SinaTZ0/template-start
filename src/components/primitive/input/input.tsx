import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "#/lib/utils";
import type { ComponentProps } from "react";
import { inputClasses } from "./input.styles";

/*===== Input =====*/

export type InputProps = ComponentProps<"input">;

function Input({ className, ...props }: InputProps) {
  return <InputPrimitive data-slot="input" {...props} className={cn(inputClasses, className)} />;
}

export { Input };
