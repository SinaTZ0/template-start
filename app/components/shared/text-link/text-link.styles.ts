import { cva } from "class-variance-authority";
import { composeStyles, defineStyles, joinStyles } from "~/components/primitive/styles";

/*===== Shared Styles =====*/

const twTextLinkStyles = defineStyles({
  layout: "group/text-link inline-flex items-center gap-2",
  // A standalone link keeps the 40px tap target; a call inside a link card is part of the card's target already.
  geometry: "rounded-sm [a&]:min-h-10",
  typography: "text-button",
  interaction: "transition-colors duration-150 ease-out outline-none",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  motion: "motion-reduce:transition-none",
});

// The arrow nudge. `[a:hover_&]` matches the text link itself or the link card around a call, so both nudge.
const twArrowStyles = defineStyles({
  geometry: "size-5 shrink-0",
  interaction: "transition-[translate] duration-150 ease-out",
  hover: "motion-safe:[a:hover_&]:-translate-x-1",
  focus: "motion-safe:[a:focus-visible_&]:-translate-x-1",
  motion: "motion-reduce:transition-none",
});

/*===== Tones =====*/

// The link tint: one step brighter on hover and focus.
const twTone = defineStyles({
  default: {
    appearance: "text-brand-text",
    hover: "[a:hover_&]:text-foreground",
    focus: "[a:focus-visible_&]:text-foreground",
  },
});

/*===== Class Composition =====*/

const textLinkVariants = cva(joinStyles(twTextLinkStyles), {
  variants: { tone: composeStyles(twTone) },
  defaultVariants: { tone: "default" },
});

const textLinkArrowClasses = joinStyles(twArrowStyles);

export { textLinkVariants, textLinkArrowClasses, twTone };
