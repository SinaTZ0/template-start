import { cva } from "class-variance-authority";
import { composeStyles, defineStyles, joinStyles } from "../styles";

/*===== Shared Styles =====*/

const twSharedStyles = defineStyles({
  // `group/button` lets icons and labels react to the button's own state.
  layout: "group/button inline-flex shrink-0 items-center justify-center",
  // A 1.5px edge, transparent unless a variant draws it, so every variant has the same size.
  geometry: "rounded-md border-[1.5px]",
  appearance: "border-transparent bg-clip-padding",
  typography: "text-button whitespace-nowrap",
  interaction:
    "transition-[color,background-color,border-color,translate] duration-150 ease-out outline-none select-none",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  // The press: a 1px drop while held. Transforms only run with motion allowed.
  active: "motion-safe:active:not-disabled:translate-y-px",
  disabled: "disabled:pointer-events-none disabled:opacity-45",
  invalid: "aria-invalid:border-destructive",
  icon: "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  // The arrow nudge: a trailing forward arrow moves 4px ahead (left in RTL) on hover and keyboard focus.
  iconNudge:
    "**:data-[icon=inline-end]:transition-[translate] **:data-[icon=inline-end]:duration-150 **:data-[icon=inline-end]:ease-out motion-safe:**:data-[icon=inline-end]:group-hover/button:-translate-x-1 motion-safe:**:data-[icon=inline-end]:group-focus-visible/button:-translate-x-1",
  motion: "motion-reduce:transition-none",
});

/*===== Appearance =====*/

// One `highlight` button per view: the page's main call to action. `default` (primary) is for in-app actions.
// Hover tints by one step; the movement is the shared press and arrow nudge above.
const twVariant = defineStyles({
  default: {
    appearance: "bg-primary text-primary-foreground",
    hover: "hover:bg-primary-hover",
  },
  highlight: {
    appearance: "bg-highlight text-highlight-foreground",
    hover: "hover:bg-highlight-hover",
  },
  outline: {
    appearance: "border-input bg-transparent text-foreground",
    hover: "hover:bg-accent",
    state: "aria-expanded:bg-accent",
  },
  secondary: {
    appearance: "bg-secondary text-secondary-foreground",
    hover: "hover:bg-accent",
    state: "aria-expanded:bg-accent",
  },
  ghost: {
    appearance: "text-brand-text",
    hover: "hover:bg-accent",
    state: "aria-expanded:bg-accent",
  },
  destructive: {
    appearance: "bg-destructive-surface text-destructive",
    hover: "hover:border-destructive",
  },
  link: {
    appearance: "text-brand-text underline-offset-4",
    hover: "hover:underline",
  },
});

/*===== Geometry =====*/

// Heights line up with the 44px inputs; `sm` and every icon size keep a 40px minimum tap target.
// `geometryIcon` tightens the padding on the side holding a `data-icon` child so the icon looks optically centered.
// `geometryGroup` restores the shared radius when compact buttons sit inside a ButtonGroup.
const twSize = defineStyles({
  xs: {
    layout: "gap-1",
    geometry: "h-8 rounded-sm px-3",
    geometryIcon: "has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
    geometryGroup: "in-data-[slot=button-group]:rounded-md",
    typography: "text-caption font-bold",
    icon: "[&_svg:not([class*='size-'])]:size-4",
  },
  sm: {
    layout: "gap-1.5",
    geometry: "h-10 rounded-sm px-4",
    geometryIcon: "has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
    geometryGroup: "in-data-[slot=button-group]:rounded-md",
    icon: "[&_svg:not([class*='size-'])]:size-4",
  },
  default: {
    layout: "gap-2",
    geometry: "h-11 px-5",
    geometryIcon: "has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-4",
  },
  lg: {
    layout: "gap-2",
    geometry: "h-12 px-6",
    geometryIcon: "has-data-[icon=inline-end]:pe-5 has-data-[icon=inline-start]:ps-5",
  },
  "icon-xs": {
    geometry: "size-8 rounded-sm",
    geometryGroup: "in-data-[slot=button-group]:rounded-md",
    icon: "[&_svg:not([class*='size-'])]:size-4",
  },
  "icon-sm": {
    geometry: "size-10 rounded-sm",
    geometryGroup: "in-data-[slot=button-group]:rounded-md",
  },
  icon: {
    geometry: "size-11",
  },
  "icon-lg": {
    geometry: "size-12",
    icon: "[&_svg:not([class*='size-'])]:size-6",
  },
});

/*===== Class Composition =====*/

const buttonVariants = cva(joinStyles(twSharedStyles), {
  variants: {
    variant: composeStyles(twVariant),
    size: composeStyles(twSize),
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export { buttonVariants, twVariant, twSize };
