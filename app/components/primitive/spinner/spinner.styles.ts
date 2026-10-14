import { defineStyles, joinStyles } from "../styles";

/*===== Spinner Styles =====*/

const twSpinnerStyles = defineStyles({
  geometry: "size-4",
  motion: "animate-spin",
});

/*===== Class Composition =====*/

const spinnerClasses = joinStyles(twSpinnerStyles);

export { spinnerClasses };
