import { defineStyles, joinStyles } from "../styles";

/*===== Label Styles =====*/

const twLabelStyles = defineStyles({
  layout: "flex items-center gap-2",
  // The field label: `body-sm` at weight 600.
  typography: "text-body-sm font-semibold",
  interaction: "select-none",
  // A label follows the disabled state of its Field group or of the control just before it.
  disabled:
    "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-45 peer-disabled:cursor-not-allowed peer-disabled:opacity-45",
});

/*===== Class Composition =====*/

const labelClasses = joinStyles(twLabelStyles);

export { labelClasses };
