import * as React from "react";
import { TextInput } from "react-native";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  React.ComponentRef<typeof TextInput>,
  React.ComponentPropsWithoutRef<typeof TextInput>
>(({ className, placeholderClassName, ...props }, ref) => {
  return (
    <TextInput
      ref={ref}
      className={cn(
        "h-10 rounded-md border border-input bg-background px-3 text-base text-foreground",
        "placeholder:text-muted-foreground",
        props.editable === false && "opacity-50",
        className,
      )}
      placeholderClassName={cn("text-muted-foreground", placeholderClassName)}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
