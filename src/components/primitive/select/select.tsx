import { Select as SelectPrimitive } from "@base-ui/react/select";
import { type VariantProps } from "class-variance-authority";
import { cn } from "#/lib/utils";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  selectGroupClasses,
  selectItemClasses,
  selectItemIndicatorClasses,
  selectItemTextClasses,
  selectLabelClasses,
  selectPopupClasses,
  selectPositionerClasses,
  selectScrollArrowClasses,
  selectSeparatorClasses,
  selectTriggerIconClasses,
  selectTriggerVariants,
  selectValueClasses,
} from "./select.styles";

/*===== Select =====*/

const Select = SelectPrimitive.Root;

export type SelectTriggerProps = SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>;
export type SelectContentProps = SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger">;

/*===== Trigger =====*/

function SelectTrigger({ className, size = "default", children, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(selectTriggerVariants({ size }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDownIcon className={selectTriggerIconClasses} />} />
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" className={cn(selectValueClasses, className)} {...props} />;
}

/*===== Popup =====*/

/**
 * Renders the portal, positioner, and popup together.
 * By default the popup is aligned over the trigger so the selected item sits on top of it, like a native select.
 */
function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className={selectPositionerClasses}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(selectPopupClasses, className)}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectScrollUpButton({ className, ...props }: ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(selectScrollArrowClasses, "top-0", className)}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({ className, ...props }: ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(selectScrollArrowClasses, "bottom-0", className)}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  );
}

/*===== Items =====*/

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" className={cn(selectGroupClasses, className)} {...props} />;
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel data-slot="select-label" className={cn(selectLabelClasses, className)} {...props} />
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item data-slot="select-item" className={cn(selectItemClasses, className)} {...props}>
      <SelectPrimitive.ItemText className={selectItemTextClasses}>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator render={<span className={selectItemIndicatorClasses} />}>
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(selectSeparatorClasses, className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
