import { cva } from "class-variance-authority";
import { composeStyles, defineStyles, joinStyles } from "../styles";

/*===== Shared Styles =====*/

const twSharedStyles = defineStyles({
  layout: "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1",
  // A pill of three words at most, so it never wraps or grows.
  geometry: "h-6 overflow-hidden rounded-full border border-transparent px-3 py-0.5",
  geometryIcon: "has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
  typography: "text-caption whitespace-nowrap",
  interaction: "transition-colors duration-150",
  focus:
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  invalid: "aria-invalid:border-destructive",
  icon: "[&>svg]:pointer-events-none [&>svg]:size-3.5!",
});

/*===== Appearance =====*/

// `default` is the quiet wash; `gold` marks one featured item per card. Status tones always pair with an icon.
const twVariant = defineStyles({
  default: {
    appearance: "bg-accent text-brand-text",
    hover: "[a]:hover:bg-accent/70",
  },
  gold: {
    appearance: "bg-gold text-gold-foreground",
    hover: "[a]:hover:bg-gold-hover",
  },
  secondary: {
    appearance: "bg-secondary text-secondary-foreground",
    hover: "[a]:hover:bg-accent",
  },
  outline: {
    appearance: "border-border text-foreground",
    hover: "[a]:hover:bg-accent",
  },
  success: { appearance: "bg-success-surface text-success" },
  warning: { appearance: "bg-warning-surface text-warning" },
  info: { appearance: "bg-info-surface text-info" },
  destructive: { appearance: "bg-destructive-surface text-destructive" },
});

/*===== Class Composition =====*/

const badgeVariants = cva(joinStyles(twSharedStyles), {
  variants: {
    variant: composeStyles(twVariant),
  },
  defaultVariants: {
    variant: "default",
  },
});

export { badgeVariants, twVariant };
