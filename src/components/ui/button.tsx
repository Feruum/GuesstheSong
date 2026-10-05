"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
export const buttonVariants = cva("inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4", { variants: { variant: { default: "bg-lime text-charcoal hover:bg-[#e2ff73]", outline: "border border-border bg-transparent text-cream hover:bg-panel", ghost: "text-cream hover:bg-panel", danger: "border border-[#df8f82] text-[#ffb9ac] hover:bg-[#54302b]" }, size: { default: "", lg: "min-h-14 px-7 text-base", icon: "size-11 p-0" } }, defaultVariants: { variant: "default", size: "default" } });
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => { const Comp = asChild ? Slot : "button"; return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />; });
Button.displayName = "Button";
