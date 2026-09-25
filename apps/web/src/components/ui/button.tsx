import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium leading-none transition-colors cursor-pointer select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 no-underline",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "border-border bg-background text-foreground shadow-card hover:bg-muted",
        ghost: "border-transparent bg-transparent text-foreground hover:bg-muted",
        danger: "border-transparent bg-danger text-white hover:bg-danger-hover",
        "danger-outline": "border-border bg-background text-danger hover:bg-danger-soft",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline px-0 h-auto"
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-9 w-9 p-0",
        "icon-sm": "h-8 w-8 p-0"
      }
    },
    defaultVariants: { variant: "primary", size: "md" }
  }
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next <Link>) with button styling. */
  asChild?: boolean;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, type, ...props },
  ref
) {
  if (asChild) {
    return <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>{children}</Slot>;
  }
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

/** Icon-only button: an accessible name is mandatory. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "size"> & { label: string; size?: "icon" | "icon-sm" }>(function IconButton(
  { label, size = "icon", variant = "ghost", ...props },
  ref
) {
  return <Button ref={ref} size={size} variant={variant} aria-label={label} title={label} {...props} />;
});
