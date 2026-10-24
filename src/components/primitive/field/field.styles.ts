import { cva } from "class-variance-authority";
import { composeStyles, defineStyles, joinStyles } from "../styles";

/*===== Set and Group Styles =====*/

const twSetStyles = defineStyles({
  layout: "flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
});

const twLegendStyles = defineStyles({
  geometry: "mb-1.5",
  typography: "font-bold",
});

// `data-variant` stays on the legend as well, because FieldDescription tightens its spacing after a legend.
const twLegendVariant = defineStyles({
  legend: {
    typography: "text-h4",
  },
  label: {
    typography: "text-body-sm",
  },
});

// The `field-group` container lets the responsive orientation switch on the group's width, not the viewport's.
const twGroupStyles = defineStyles({
  layout:
    "group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4",
});

/*===== Field Styles =====*/

const twFieldStyles = defineStyles({
  layout: "group/field flex w-full gap-2",
  invalid: "data-[invalid=true]:text-destructive",
});

const twOrientation = defineStyles({
  vertical: {
    layout: "flex-col *:w-full [&>.sr-only]:w-auto",
  },
  horizontal: {
    layout: "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto",
    // Nudges a checkbox or radio down to line up with the first line of the label.
    geometryControl: "has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
  },
  responsive: {
    layout:
      "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto",
    geometryControl: "@md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
  },
});

/*===== Compound Part Styles =====*/

const twContentStyles = defineStyles({
  layout: "group/field-content flex flex-1 flex-col gap-0.5",
  typography: "leading-snug",
});

// A label that wraps a whole Field becomes a selectable card, as in a choice list.
const twLabelStyles = defineStyles({
  layout: "group/field-label peer/field-label flex w-fit gap-2",
  typography: "leading-snug",
  disabled: "group-data-[disabled=true]/field:opacity-45",
  // A checked choice card takes the selected-row wash and a primary edge.
  state: "has-data-checked:border-primary has-data-checked:bg-accent",
  layoutCard: "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
  geometryCard:
    "has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border-[1.5px] *:data-[slot=field]:px-4 *:data-[slot=field]:py-3",
  hoverCard: "has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-accent",
  // The card draws the ring for the control inside it.
  focusCard:
    "has-[>[data-slot=field]]:has-focus-visible:outline-2 has-[>[data-slot=field]]:has-focus-visible:outline-offset-2 has-[>[data-slot=field]]:has-focus-visible:outline-ring has-[>[data-slot=field]]:has-focus-visible:outline-solid",
});

const twTitleStyles = defineStyles({
  layout: "flex w-fit items-center gap-2",
  typography: "text-body-sm font-semibold",
  disabled: "group-data-[disabled=true]/field:opacity-45",
});

const twDescriptionStyles = defineStyles({
  // Pulls the description closer to a legend or to the control just above it.
  geometry: "last:mt-0 nth-last-2:-mt-1 [[data-variant=legend]+&]:-mt-1.5",
  // The hint line: `caption` in `ink-muted`.
  typography:
    "text-start text-caption font-normal group-has-data-horizontal/field:text-balance [&>a]:underline [&>a]:underline-offset-4",
  appearance: "text-muted-foreground",
  hover: "[&>a:hover]:text-brand-text",
});

const twSeparatorStyles = defineStyles({
  layout: "relative",
  geometry: "-my-2 h-5 group-data-[variant=outline]/field-group:-mb-2",
  typography: "text-body-sm",
});

const twSeparatorContentStyles = defineStyles({
  layout: "relative mx-auto block w-fit",
  geometry: "px-2",
  appearance: "bg-background text-muted-foreground",
});

// The error line: `caption` in the danger colour, always led by the circle-alert icon (FieldError adds it).
const twErrorStyles = defineStyles({
  layout: "flex items-start gap-1",
  typography: "text-caption",
  appearance: "text-destructive",
  // Centres the 14px icon on the first 20px line.
  icon: "[&>svg]:mt-0.75 [&>svg]:size-3.5 [&>svg]:shrink-0",
});

const twErrorListStyles = defineStyles({
  layout: "flex list-disc flex-col gap-1",
  geometry: "ms-4",
});

/*===== Class Composition =====*/

const fieldSetClasses = joinStyles(twSetStyles);

const fieldLegendVariants = cva(joinStyles(twLegendStyles), {
  variants: {
    variant: composeStyles(twLegendVariant),
  },
  defaultVariants: { variant: "legend" },
});

const fieldGroupClasses = joinStyles(twGroupStyles);

const fieldVariants = cva(joinStyles(twFieldStyles), {
  variants: {
    orientation: composeStyles(twOrientation),
  },
  defaultVariants: { orientation: "vertical" },
});

const fieldContentClasses = joinStyles(twContentStyles);
const fieldLabelClasses = joinStyles(twLabelStyles);
const fieldTitleClasses = joinStyles(twTitleStyles);
const fieldDescriptionClasses = joinStyles(twDescriptionStyles);
const fieldSeparatorClasses = joinStyles(twSeparatorStyles);
const fieldSeparatorContentClasses = joinStyles(twSeparatorContentStyles);
const fieldErrorClasses = joinStyles(twErrorStyles);
const fieldErrorListClasses = joinStyles(twErrorListStyles);

export {
  fieldSetClasses,
  fieldLegendVariants,
  fieldGroupClasses,
  fieldVariants,
  fieldContentClasses,
  fieldLabelClasses,
  fieldTitleClasses,
  fieldDescriptionClasses,
  fieldSeparatorClasses,
  fieldSeparatorContentClasses,
  fieldErrorClasses,
  fieldErrorListClasses,
  twOrientation,
};
