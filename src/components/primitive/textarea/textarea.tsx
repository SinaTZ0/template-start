import { cn } from "cn";
import type { ComponentProps } from "react";
import { textareaClasses } from "./textarea.styles";

/*===== Textarea =====*/

export type TextareaProps = ComponentProps<"textarea">;

function Textarea({ className, ...props }: TextareaProps) {
  return <textarea data-slot="textarea" {...props} className={cn(textareaClasses, className)} />;
}

export { Textarea };
