import { defineStyles, joinStyles } from "../styles";

/*===== Separator Styles =====*/

const twSeparatorStyles = defineStyles({
  layout: "shrink-0 data-vertical:self-stretch",
  geometry: "data-horizontal:h-px data-horizontal:w-full data-vertical:w-px",
  appearance: "bg-border",
});

/*===== Class Composition =====*/

const separatorClasses = joinStyles(twSeparatorStyles);

export { separatorClasses };
