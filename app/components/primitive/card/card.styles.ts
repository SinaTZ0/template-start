import { cva } from "class-variance-authority";
import { composeStyles, defineStyles, joinStyles } from "../styles";

/*===== Surface Styles =====*/

// Parts space themselves with `--card-spacing`, so a size only has to change that one variable.
const twCardStyles = defineStyles({
  layout: "group/card flex flex-col gap-(--card-spacing) overflow-hidden",
  geometry: "rounded-lg py-(--card-spacing)",
  // The footer brings its own padding, so the card drops its bottom padding.
  geometryFooter: "has-data-[slot=card-footer]:pb-0",
  // Edge-to-edge media replaces the card's top padding; the card's `overflow-hidden` rounds its corners.
  geometryMedia:
    "has-[>[data-slot=card-media]:first-child]:pt-0 has-[>img:first-child]:pt-0 *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg",
  typography: "text-body-sm",
  // Cards rest on a hairline plus `shadow-sm`.
  appearance: "bg-card text-card-foreground shadow-sm ring-1 ring-border",
  // The card lift, for a card rendered as a link (`render={<SiteLink … />}`): `shadow-md` and a faint `accent` wash.
  // The wash mixes `accent` into `card` instead of using `bg-accent/40`, which would show the darker page through
  // the card in dark mode.
  interaction: "transition-[background-color,box-shadow] duration-200 ease-out outline-none",
  hover: "[a&]:hover:bg-[color-mix(in_oklab,var(--accent)_40%,var(--card))] [a&]:hover:shadow-md",
  focus:
    "focus-visible:bg-[color-mix(in_oklab,var(--accent)_40%,var(--card))] focus-visible:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  motion: "motion-reduce:transition-none",
});

const twSize = defineStyles({
  default: {
    geometry: "[--card-spacing:--spacing(5)]",
  },
  sm: {
    geometry: "[--card-spacing:--spacing(4)]",
  },
});

/*===== Compound Part Styles =====*/

const twHeaderStyles = defineStyles({
  layout:
    "group/card-header @container/card-header grid auto-rows-min items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
  geometry: "rounded-t-lg px-(--card-spacing) [.border-b]:pb-(--card-spacing)",
});

// The title tint: inside a hovered or focused link card, the title takes `brand-text`. `[a:hover_&]` matches any
// link ancestor, so it never fires on a plain card.
const twTitleStyles = defineStyles({
  typography: "font-heading text-h3 group-data-[size=sm]/card:text-h4",
  interaction: "transition-colors duration-150 ease-out",
  hover: "[a:hover_&]:text-brand-text",
  focus: "[a:focus-visible_&]:text-brand-text",
  motion: "motion-reduce:transition-none",
});

const twDescriptionStyles = defineStyles({
  typography: "text-body-sm",
  appearance: "text-muted-foreground",
});

const twActionStyles = defineStyles({
  layout: "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
});

const twContentStyles = defineStyles({
  geometry: "px-(--card-spacing)",
});

const twFooterStyles = defineStyles({
  layout: "flex items-center",
  geometry: "rounded-b-lg border-t p-(--card-spacing)",
  appearance: "bg-muted",
});

/*===== Media Styles =====*/

// The media frame clips its image so the media zoom stays inside it. `bg-muted` shows while the image loads and
// around a contained poster.
const twMediaStyles = defineStyles({
  layout: "relative shrink-0 overflow-hidden",
  appearance: "bg-muted",
  geometry: "[&_img]:size-full",
  // The media zoom: the photo scales to 1.03 inside a hovered or focused link card.
  interaction: "[&_img]:transition-[scale] [&_img]:duration-300 [&_img]:ease-out",
  hover: "motion-safe:[a:hover_&_img]:scale-[1.03]",
  focus: "motion-safe:[a:focus-visible_&_img]:scale-[1.03]",
});

// Images that contain text (posters, flyers, certificates) must keep their own title readable: crop from the top,
// or show the whole image on `muted`. Photos fill the frame.
const twMediaFit = defineStyles({
  cover: {
    geometry: "[&_img]:object-cover",
  },
  top: {
    geometry: "[&_img]:object-cover [&_img]:object-top",
  },
  contain: {
    geometry: "[&_img]:object-contain",
  },
});

/*===== Class Composition =====*/

const cardVariants = cva(joinStyles(twCardStyles), {
  variants: {
    size: composeStyles(twSize),
  },
  defaultVariants: { size: "default" },
});

const cardMediaVariants = cva(joinStyles(twMediaStyles), {
  variants: {
    fit: composeStyles(twMediaFit),
  },
  defaultVariants: { fit: "cover" },
});

const cardHeaderClasses = joinStyles(twHeaderStyles);
const cardTitleClasses = joinStyles(twTitleStyles);
const cardDescriptionClasses = joinStyles(twDescriptionStyles);
const cardActionClasses = joinStyles(twActionStyles);
const cardContentClasses = joinStyles(twContentStyles);
const cardFooterClasses = joinStyles(twFooterStyles);

export {
  cardVariants,
  cardMediaVariants,
  cardHeaderClasses,
  cardTitleClasses,
  cardDescriptionClasses,
  cardActionClasses,
  cardContentClasses,
  cardFooterClasses,
  twSize,
  twMediaFit,
};
