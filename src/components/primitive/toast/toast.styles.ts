import { defineStyles, joinStyles } from "../styles";

/*===== Viewport Styles =====*/

// Full width with side gutters on phones; pinned to the inline end from `sm` up.
const twViewportStyles = defineStyles({
  layout: "pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto sm:inset-s-auto sm:inset-e-4 sm:mx-0",
  geometry: "w-auto max-w-sm sm:w-full",
  focus: "outline-none",
});

/*===== Toast Styles =====*/

// Base UI exposes each toast's index, height and swipe offset as CSS variables. The stack is built from them:
// toasts behind the front one peek out above it and shrink, and expand into a list on hover or focus.
const twToastStyles = defineStyles({
  layout:
    "group/toast pointer-events-auto absolute inset-e-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom",
  layoutStack:
    "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
  geometry:
    "h-(--height) transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] rounded-md border",
  // Fills the gap below each toast so hover doesn't drop while the pointer moves between toasts.
  geometryGap:
    "after:absolute after:inset-s-0 after:top-full after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
  appearance: "bg-popover text-popover-foreground shadow-md",
  interaction:
    "will-change-transform outline-none select-none [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  state:
    "data-expanded:h-(--toast-height) data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))] data-limited:opacity-0 data-starting-style:transform-[translateY(150%)]",
  // Leaves in the direction it was swiped, or slides down when it times out or is closed.
  stateExit:
    "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))] data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))] data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))] data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))] data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))] [&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:transform-[translateY(150%)]",
});

/*===== Compound Part Styles =====*/

// Only the front toast's content is visible until the stack expands.
const twContentStyles = defineStyles({
  layout: "flex h-full items-center gap-3 overflow-hidden",
  geometry: "p-4",
  interaction: "transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
  state: "data-behind:opacity-0 data-expanded:opacity-100",
});

const twTitleStyles = defineStyles({
  typography: "text-body-sm font-bold",
});

const twDescriptionStyles = defineStyles({
  typography: "text-body-sm",
  appearance: "text-muted-foreground",
});

const twActionStyles = defineStyles({
  layout: "shrink-0",
});

// The `after:` box enlarges the small close button's hit area.
const twCloseStyles = defineStyles({
  layout: "relative shrink-0 after:absolute after:-inset-2 after:content-['']",
  appearance: "text-muted-foreground",
  hover: "hover:text-foreground",
});

const twIconStyles = defineStyles({
  layout: "shrink-0",
  icon: "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5",
});

const twTextStyles = defineStyles({
  layout: "flex min-w-0 flex-1 flex-col gap-1",
});

/*===== Class Composition =====*/

const toastViewportClasses = joinStyles(twViewportStyles);
const toastClasses = joinStyles(twToastStyles);
const toastContentClasses = joinStyles(twContentStyles);
const toastTitleClasses = joinStyles(twTitleStyles);
const toastDescriptionClasses = joinStyles(twDescriptionStyles);
const toastActionClasses = joinStyles(twActionStyles);
const toastCloseClasses = joinStyles(twCloseStyles);
const toastIconClasses = joinStyles(twIconStyles);
const toastTextClasses = joinStyles(twTextStyles);

export {
  toastViewportClasses,
  toastClasses,
  toastContentClasses,
  toastTitleClasses,
  toastDescriptionClasses,
  toastActionClasses,
  toastCloseClasses,
  toastIconClasses,
  toastTextClasses,
};
