import { defineStyles, joinStyles } from "../styles";

/*===== Textarea Styles =====*/

const twTextareaStyles = defineStyles({
  // `field-sizing-content` grows the textarea with its content, starting from `min-h-28`.
  layout: "flex field-sizing-content w-full",
  // Same 1.5px `input` edge as Input.
  geometry: "min-h-28 rounded-sm border-[1.5px] px-4 py-3",
  // The `body` style at 16px also keeps iOS Safari from zooming in on focus.
  typography: "text-body",
  appearance: "border-input bg-card placeholder:text-muted-foreground",
  interaction: "transition-colors duration-150 outline-none",
  hover: "hover:border-muted-foreground",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  disabled: "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-45",
  invalid: "aria-invalid:border-destructive",
});

const textareaClasses = joinStyles(twTextareaStyles);

export { textareaClasses };
