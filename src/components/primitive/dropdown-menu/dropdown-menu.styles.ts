import { defineStyles, joinStyles } from "../styles";

/*===== Popup =====*/

const twContentStyles = defineStyles({
  layout:
    "z-50 max-h-(--available-height) w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-x-hidden overflow-y-auto outline-none",
  geometry: "rounded-md p-1",
  appearance: "bg-popover text-popover-foreground shadow-md ring-1 ring-border",
  state:
    "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
  stateSide:
    "data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-start-2 data-[side=inline-start]:slide-in-from-end-2 data-[side=top]:slide-in-from-bottom-2",
  motion: "motion-reduce:animate-none",
});

const twSubContentStyles = defineStyles({
  layout: "w-auto min-w-24",
});

/*===== Items =====*/

// Rows are at least 40px tall (the tap-target floor). Selected and focused rows take the quiet `accent` wash.
const twItemStyles = defineStyles({
  layout: "group/dropdown-menu-item relative flex items-center gap-2",
  geometry: "min-h-10 rounded-sm px-3 py-2 data-inset:ps-8",
  typography: "text-body-sm",
  interaction: "cursor-default outline-hidden select-none",
  focus: "focus:bg-accent focus:text-accent-foreground",
  disabled: "data-disabled:pointer-events-none data-disabled:opacity-45",
  state: "data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive-surface",
  icon: "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
});

const twSubTriggerStyles = defineStyles({
  state:
    "data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground",
});

// Checkbox and radio rows reserve the inline-end column for their indicator.
const twIndicatorItemStyles = defineStyles({
  geometry: "pe-9",
});

const twIndicatorStyles = defineStyles({
  layout: "pointer-events-none absolute inset-e-3 flex items-center justify-center",
});

const twLabelStyles = defineStyles({
  geometry: "px-3 py-2 data-inset:ps-8",
  typography: "text-caption",
  appearance: "text-muted-foreground",
});

const twSeparatorStyles = defineStyles({
  geometry: "-mx-1 my-1 h-px",
  appearance: "bg-border",
});

const twShortcutStyles = defineStyles({
  layout: "ms-auto",
  typography: "text-caption tracking-widest",
  appearance: "text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
});

export const dropdownMenuContentClasses = joinStyles(twContentStyles);
export const dropdownMenuSubContentClasses = joinStyles(twSubContentStyles);
export const dropdownMenuItemClasses = joinStyles(twItemStyles);
export const dropdownMenuSubTriggerClasses = joinStyles({ ...twItemStyles, ...twSubTriggerStyles });
export const dropdownMenuIndicatorItemClasses = joinStyles({ ...twItemStyles, ...twIndicatorItemStyles });
export const dropdownMenuIndicatorClasses = joinStyles(twIndicatorStyles);
export const dropdownMenuLabelClasses = joinStyles(twLabelStyles);
export const dropdownMenuSeparatorClasses = joinStyles(twSeparatorStyles);
export const dropdownMenuShortcutClasses = joinStyles(twShortcutStyles);
