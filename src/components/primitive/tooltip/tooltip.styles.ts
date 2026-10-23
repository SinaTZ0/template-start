import { defineStyles, joinStyles } from "../styles";

/*===== Popup Styles =====*/

const twPositionerStyles = defineStyles({
  layout: "isolate z-50",
});

const twContentStyles = defineStyles({
  layout: "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5",
  geometry: "rounded-sm px-3 py-1.5",
  // Tightens the end padding when the tooltip ends with a keyboard shortcut.
  geometryKbd: "has-data-[slot=kbd]:pe-1.5",
  typography: "text-caption",
  appearance: "bg-foreground text-background",
  // Lifts nested `Kbd`s above the arrow.
  appearanceKbd:
    "**:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
  state:
    "data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-start-2 data-[side=inline-start]:slide-in-from-end-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
});

// Base UI reports the physical side, so the arrow is placed with physical `left`/`right` on purpose.
const twArrowStyles = defineStyles({
  layout:
    "z-50 data-[side=bottom]:top-1 data-[side=inline-end]:-start-1 data-[side=inline-end]:top-1/2! data-[side=inline-start]:-end-1 data-[side=inline-start]:top-1/2! data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=top]:-bottom-2.5",
  geometry:
    "size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:-translate-y-1/2 data-[side=right]:-translate-y-1/2",
  appearance: "bg-foreground fill-foreground",
});

/*===== Class Composition =====*/

const tooltipPositionerClasses = joinStyles(twPositionerStyles);
const tooltipContentClasses = joinStyles(twContentStyles);
const tooltipArrowClasses = joinStyles(twArrowStyles);

export { tooltipPositionerClasses, tooltipContentClasses, tooltipArrowClasses };
