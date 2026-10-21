import { cva } from "class-variance-authority";
import { composeStyles, defineStyles, joinStyles } from "../styles";

/*===== Trigger Styles =====*/

const twTriggerStyles = defineStyles({
  layout: "flex w-fit items-center justify-between gap-2",
  // The selected value renders as a single clamped row, even when an item contains an icon.
  layoutValue:
    "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5",
  // Same chrome as Input: 1.5px `input` edge.
  geometry: "rounded-sm border-[1.5px] py-2 ps-4 pe-3",
  // The `body` style at 16px also keeps iOS Safari from zooming in on focus.
  typography: "text-body whitespace-nowrap",
  appearance: "border-input bg-card data-placeholder:text-muted-foreground",
  hover: "hover:border-muted-foreground",
  interaction: "transition-colors duration-150 outline-none select-none",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  disabled: "disabled:cursor-not-allowed disabled:opacity-45",
  invalid: "aria-invalid:border-destructive",
  icon: "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
});

const twTriggerSize = defineStyles({
  default: {
    geometry: "h-11",
  },
  sm: {
    geometry: "h-10",
  },
});

const twTriggerIconStyles = defineStyles({
  interaction: "pointer-events-none",
  geometry: "size-5",
  appearance: "text-muted-foreground",
});

const twValueStyles = defineStyles({
  layout: "flex flex-1",
  typography: "text-start",
});

/*===== Popup Styles =====*/

const twPositionerStyles = defineStyles({
  layout: "isolate z-50",
});

const twPopupStyles = defineStyles({
  layout: "relative isolate z-50 overflow-x-hidden overflow-y-auto",
  // Base UI provides the available height, trigger width, and transform origin as CSS variables.
  geometry: "max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) rounded-md",
  // The dropdown panel: a hairline plus `shadow-md`.
  appearance: "bg-popover text-popover-foreground shadow-md ring-1 ring-border",
  state:
    "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
  stateSide:
    "data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-start-2 data-[side=inline-start]:slide-in-from-end-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
  // A popup aligned over its trigger opens in place, so a slide would look like a jump.
  stateAligned: "data-[align-trigger=true]:animate-none",
});

const twScrollArrowStyles = defineStyles({
  layout: "z-10 flex w-full items-center justify-center",
  geometry: "py-1",
  appearance: "bg-popover",
  interaction: "cursor-default",
  icon: "[&_svg:not([class*='size-'])]:size-4",
});

/*===== Item Styles =====*/

const twGroupStyles = defineStyles({
  geometry: "scroll-my-1 p-1",
});

const twLabelStyles = defineStyles({
  geometry: "px-2.5 py-1",
  typography: "text-caption",
  appearance: "text-muted-foreground",
});

const twItemStyles = defineStyles({
  layout: "relative flex w-full items-center gap-1.5",
  // A trailing span (such as a shortcut hint) lays out its own children in a row.
  layoutTrailing: "*:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
  // `pe-8` reserves room for the absolutely positioned check indicator.
  geometry: "min-h-10 rounded-sm py-2 ps-2.5 pe-8",
  typography: "text-body-sm",
  interaction: "cursor-default outline-hidden select-none",
  focus: "focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground",
  disabled: "data-disabled:pointer-events-none data-disabled:opacity-45",
  icon: "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
});

const twItemTextStyles = defineStyles({
  layout: "flex flex-1 shrink-0 gap-2",
  typography: "whitespace-nowrap",
});

const twItemIndicatorStyles = defineStyles({
  layout: "absolute end-2 flex items-center justify-center",
  geometry: "size-4",
  interaction: "pointer-events-none",
});

const twSeparatorStyles = defineStyles({
  geometry: "-mx-1 my-1 h-px",
  appearance: "bg-border",
  interaction: "pointer-events-none",
});

/*===== Class Composition =====*/

const selectTriggerVariants = cva(joinStyles(twTriggerStyles), {
  variants: { size: composeStyles(twTriggerSize) },
  defaultVariants: { size: "default" },
});

const selectTriggerIconClasses = joinStyles(twTriggerIconStyles);
const selectValueClasses = joinStyles(twValueStyles);
const selectPositionerClasses = joinStyles(twPositionerStyles);
const selectPopupClasses = joinStyles(twPopupStyles);
const selectScrollArrowClasses = joinStyles(twScrollArrowStyles);
const selectGroupClasses = joinStyles(twGroupStyles);
const selectLabelClasses = joinStyles(twLabelStyles);
const selectItemClasses = joinStyles(twItemStyles);
const selectItemTextClasses = joinStyles(twItemTextStyles);
const selectItemIndicatorClasses = joinStyles(twItemIndicatorStyles);
const selectSeparatorClasses = joinStyles(twSeparatorStyles);

export {
  selectTriggerVariants,
  selectTriggerIconClasses,
  selectValueClasses,
  selectPositionerClasses,
  selectPopupClasses,
  selectScrollArrowClasses,
  selectGroupClasses,
  selectLabelClasses,
  selectItemClasses,
  selectItemTextClasses,
  selectItemIndicatorClasses,
  selectSeparatorClasses,
  twTriggerSize,
};
