import { cva } from "class-variance-authority";
import { composeStyles, defineStyles, joinStyles } from "../styles";

/*===== Group Styles =====*/

// The group draws the field chrome; its control is borderless and the group reacts to the control's state.
const twGroupStyles = defineStyles({
  layout: "group/input-group relative flex w-full min-w-0 items-center",
  // Block-aligned addons and textareas stack vertically, so the fixed height gives way.
  layoutBlock:
    "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto",
  // Same chrome as Input: 44px, 1.5px `input` edge.
  geometry: "h-11 rounded-sm border-[1.5px]",
  // The input yields padding on the side an addon occupies.
  geometryAddon:
    "has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pe-1.5 has-[>[data-align=inline-start]]:[&>input]:ps-1.5",
  appearance: "border-input bg-card",
  interaction: "transition-colors duration-150 outline-none",
  hover: "hover:border-muted-foreground",
  // The group draws the control's focus ring, so the ring wraps the addons too.
  focus:
    "has-[[data-slot=input-group-control]:focus-visible]:outline-2 has-[[data-slot=input-group-control]:focus-visible]:outline-offset-2 has-[[data-slot=input-group-control]:focus-visible]:outline-ring has-[[data-slot=input-group-control]:focus-visible]:outline-solid",
  // Inside a combobox popup the popup itself shows focus, so the group stays quiet.
  focusCombobox:
    "in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:outline-none",
  disabled: "has-disabled:bg-muted has-disabled:opacity-45",
  invalid: "has-[[data-slot][aria-invalid=true]]:border-destructive",
});

/*===== Addon Styles =====*/

const twAddonStyles = defineStyles({
  layout: "flex items-center justify-center gap-2",
  geometry: "h-auto py-1.5",
  geometryKbd: "[&>kbd]:rounded-[calc(var(--radius)-5px)]",
  typography: "text-body-sm font-medium",
  appearance: "text-muted-foreground",
  interaction: "cursor-text select-none",
  disabled: "group-data-[disabled=true]/input-group:opacity-45",
  icon: "[&>svg:not([class*='size-'])]:size-5",
});

// Negative margins pull nested buttons and kbds toward the group edge so their own padding lines up.
const twAddonAlign = defineStyles({
  "inline-start": {
    layout: "order-first",
    geometry: "ps-4 has-[>button]:ms-[-0.3rem] has-[>kbd]:ms-[-0.15rem]",
  },
  "inline-end": {
    layout: "order-last",
    geometry: "pe-4 has-[>button]:me-[-0.3rem] has-[>kbd]:me-[-0.15rem]",
  },
  "block-start": {
    layout: "order-first w-full justify-start",
    geometry: "px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
  },
  "block-end": {
    layout: "order-last w-full justify-start",
    geometry: "px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
  },
});

/*===== Button Styles =====*/

const twButtonStyles = defineStyles({
  layout: "flex items-center gap-2",
  typography: "text-body-sm",
  appearance: "shadow-none",
  icon: "[&_svg:not([class*='size-'])]:size-4",
});

const twButtonSize = defineStyles({
  xs: {
    layout: "gap-1",
    geometry: "h-6 rounded-[calc(var(--radius)-3px)] px-1.5",
    icon: "[&>svg:not([class*='size-'])]:size-3.5",
  },
  sm: {},
  "icon-xs": {
    geometry: "size-6 rounded-[calc(var(--radius)-3px)] p-0 has-[>svg]:p-0",
  },
  "icon-sm": {
    geometry: "size-8 p-0 has-[>svg]:p-0",
  },
});

/*===== Text Styles =====*/

const twTextStyles = defineStyles({
  layout: "flex items-center gap-2",
  typography: "text-body-sm",
  appearance: "text-muted-foreground",
  icon: "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
});

/*===== Control Styles =====*/

// Controls drop their own field chrome because the group draws it.
const twInputStyles = defineStyles({
  layout: "h-full flex-1",
  // Rounded like the group (minus its 1.5px border) so nothing paints square corners over it.
  geometry: "rounded-[calc(var(--radius-sm)-1.5px)] border-0",
  appearance: "bg-transparent shadow-none",
  focus: "focus-visible:outline-none",
  disabled: "disabled:bg-transparent",
  // Chrome fills autofilled inputs with its own color, which shows as a box inside the group.
  // An inset shadow in the group's background is the reliable way to cover it.
  stateAutofill: "autofill:shadow-[inset_0_0_0_100px_var(--card)] autofill:[-webkit-text-fill-color:var(--foreground)]",
});

const twTextareaStyles = defineStyles({
  layout: "flex-1",
  geometry: "rounded-none border-0 py-2",
  appearance: "bg-transparent shadow-none",
  interaction: "resize-none",
  focus: "focus-visible:outline-none",
  disabled: "disabled:bg-transparent",
});

/*===== Class Composition =====*/

const inputGroupAddonVariants = cva(joinStyles(twAddonStyles), {
  variants: { align: composeStyles(twAddonAlign) },
  defaultVariants: { align: "inline-start" },
});

const inputGroupButtonVariants = cva(joinStyles(twButtonStyles), {
  variants: { size: composeStyles(twButtonSize) },
  defaultVariants: { size: "xs" },
});

const inputGroupClasses = joinStyles(twGroupStyles);
const inputGroupTextClasses = joinStyles(twTextStyles);
const inputGroupInputClasses = joinStyles(twInputStyles);
const inputGroupTextareaClasses = joinStyles(twTextareaStyles);

export {
  inputGroupAddonVariants,
  inputGroupButtonVariants,
  inputGroupClasses,
  inputGroupTextClasses,
  inputGroupInputClasses,
  inputGroupTextareaClasses,
  twAddonAlign,
  twButtonSize,
};
