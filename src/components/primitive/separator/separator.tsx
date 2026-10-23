import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "cn";
import { separatorClasses } from "./separator.styles";

/*===== Separator =====*/

function Separator({ className, orientation = "horizontal", ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(separatorClasses, className)}
      {...props}
    />
  );
}

export { Separator };
