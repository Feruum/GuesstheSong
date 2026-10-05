"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
export const Slider = React.forwardRef<React.ComponentRef<typeof Primitive.Root>, React.ComponentPropsWithoutRef<typeof Primitive.Root>>(({ className, "aria-label": label, ...props }, ref) => <Primitive.Root ref={ref} className={cn("relative flex min-h-11 w-full touch-none select-none items-center", className)} {...props}><Primitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-border"><Primitive.Range className="absolute h-full bg-lime" /></Primitive.Track><Primitive.Thumb aria-label={label} className="block size-4 rounded-full border border-cream bg-cream shadow focus:outline-none focus:ring-2 focus:ring-lime focus:ring-offset-4 focus:ring-offset-background" /></Primitive.Root>);
Slider.displayName = "Slider";
