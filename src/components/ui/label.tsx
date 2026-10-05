"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";
export const Label = React.forwardRef<React.ComponentRef<typeof Primitive.Root>, React.ComponentPropsWithoutRef<typeof Primitive.Root>>(({ className, ...props }, ref) => <Primitive.Root ref={ref} className={cn("mb-2 block text-sm font-medium text-cream", className)} {...props} />);
Label.displayName = "Label";
