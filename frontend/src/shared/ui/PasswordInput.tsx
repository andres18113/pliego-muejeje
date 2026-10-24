import { useState, type ComponentPropsWithRef } from "react";
import { MaterialSymbol } from "./MaterialSymbol";

/**
 * A password field with PLIEGO's reveal control: the Material eye inside the field's end. The button keeps one
 * name ("Mostrar contraseña") and states whether the text is shown with aria-pressed; pressing it never moves
 * focus out of the field, so typing and blur validation continue where they were.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentPropsWithRef<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input">
    <input {...props} className={["password-input__control", className].filter(Boolean).join(" ")} type={visible ? "text" : "password"} />
    <button type="button" className="password-input__toggle" aria-label="Mostrar contraseña" aria-pressed={visible}
      aria-controls={props.id} disabled={props.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setVisible((current) => !current)}>
      <MaterialSymbol name={visible ? "visibility_off" : "visibility"} size={20} />
    </button>
  </span>;
}
