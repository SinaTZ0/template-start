import { defineStyles, joinStyles } from "../styles";

/*===== Input Styles =====*/

const twInputStyles = defineStyles({
  layout: "w-full min-w-0",
  // The control edge: 1.5px `input` (border-strong), which meets 3:1 on every surface.
  geometry: "h-11 rounded-sm border-[1.5px] px-4 py-1",
  // The `body` style at 16px also keeps iOS Safari from zooming in on focus.
  typography: "text-body",
  appearance: "border-input bg-card placeholder:text-muted-foreground",
  // The native file-picker button inside `type="file"` inputs.
  appearanceFile:
    "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
  interaction: "transition-colors duration-150 outline-none",
  hover: "hover:border-muted-foreground",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  disabled: "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-45",
  invalid: "aria-invalid:border-destructive",
});

const inputClasses = joinStyles(twInputStyles);

export { inputClasses };
