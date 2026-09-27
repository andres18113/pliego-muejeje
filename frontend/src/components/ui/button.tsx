import { Button as BaseButton, type ButtonState } from "@base-ui/react/button";
import type { ComponentProps } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "text";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "button button-primary",
  secondary: "button button-secondary",
  text: "text-button",
};

function variantClass(variant?: ButtonVariant) {
  return variant ? variantClasses[variant] : undefined;
}

export type ButtonProps = ComponentProps<typeof BaseButton> & {
  variant?: ButtonVariant;
};

export type ButtonLinkProps = Omit<LinkProps, "className"> & {
  variant: ButtonVariant;
  className?: string;
};

export function Button({ variant, className, ...props }: ButtonProps) {
  const baseClass = variantClass(variant);
  const mergedClassName = typeof className === "function"
    ? (state: ButtonState) => cn(baseClass, className(state))
    : cn(baseClass, className);
  return <BaseButton {...props} className={mergedClassName} />;
}

export function ButtonLink({ variant, className, ...props }: ButtonLinkProps) {
  return <Link {...props} className={cn(variantClass(variant), className)} />;
}
