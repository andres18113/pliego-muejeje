import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type FieldProps = Omit<ComponentProps<"div">, "children"> & {
  controlId: string;
  label: ReactNode;
  children: ReactNode;
};

export function Field({ controlId, label, className, children, ...props }: FieldProps) {
  return (
    <div {...props} className={cn("form-field", className)}>
      <label htmlFor={controlId}>{label}</label>
      {children}
    </div>
  );
}

export function FieldMessage({
  id,
  tone,
  children,
}: {
  id?: string;
  tone: "help" | "error";
  children: ReactNode;
}) {
  return (
    <span id={id} className={tone === "error" ? "field-error" : "field-help"}>
      {children}
    </span>
  );
}
