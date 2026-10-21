import { cva } from "class-variance-authority";
import { composeStyles, defineStyles, joinStyles } from "../styles";

/*===== Alert Styles =====*/

const twAlertStyles = defineStyles({
  // A leading icon gets its own column and spans the title and description rows.
  layout:
    "group/alert relative grid w-full gap-0.5 has-data-[slot=alert-action]:relative has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3",
  geometry: "rounded-md border px-5 py-4",
  // Leaves room at the end for the absolutely positioned AlertAction.
  geometryAction: "has-data-[slot=alert-action]:pe-24",
  typography: "text-start text-body-sm",
  // The icon takes the tone colour; 20px sits centred on the first line of the 30px title.
  icon: "*:[svg]:row-span-2 *:[svg]:translate-y-1 *:[svg]:text-(--tone) *:[svg:not([class*='size-'])]:size-5",
});

// Notices: a tinted ground and a hairline in the tone colour, a title and icon in it, and the message in `ink`.
// Status is never colour alone: pair the tone with its icon (info, check-circle-2, alert-triangle, circle-alert)
// and a title. `default` is the neutral card for notes that carry no status.
const twVariant = defineStyles({
  default: {
    appearance: "border-border bg-card text-card-foreground [--tone:var(--brand-text)]",
  },
  info: {
    appearance: "border-info bg-info-surface text-foreground [--tone:var(--info)]",
  },
  success: {
    appearance: "border-success bg-success-surface text-foreground [--tone:var(--success)]",
  },
  warning: {
    appearance: "border-warning bg-warning-surface text-foreground [--tone:var(--warning)]",
  },
  destructive: {
    appearance: "border-destructive bg-destructive-surface text-foreground [--tone:var(--destructive)]",
  },
});

/*===== Compound Part Styles =====*/

const twTitleStyles = defineStyles({
  layout: "group-has-[>svg]/alert:col-start-2",
  typography: "text-h4 [&_a]:underline [&_a]:underline-offset-3",
  appearance: "text-(--tone)",
  hover: "[&_a]:hover:text-foreground",
});

const twDescriptionStyles = defineStyles({
  geometry: "[&_p:not(:last-child)]:mb-4",
  typography: "text-body-sm text-balance md:text-pretty [&_a]:underline [&_a]:underline-offset-3",
  hover: "[&_a]:hover:text-brand-text",
});

const twActionStyles = defineStyles({
  layout: "absolute end-4 top-4",
});

/*===== Class Composition =====*/

const alertVariants = cva(joinStyles(twAlertStyles), {
  variants: {
    variant: composeStyles(twVariant),
  },
  defaultVariants: { variant: "default" },
});

const alertTitleClasses = joinStyles(twTitleStyles);
const alertDescriptionClasses = joinStyles(twDescriptionStyles);
const alertActionClasses = joinStyles(twActionStyles);

export { alertVariants, alertTitleClasses, alertDescriptionClasses, alertActionClasses, twVariant };
