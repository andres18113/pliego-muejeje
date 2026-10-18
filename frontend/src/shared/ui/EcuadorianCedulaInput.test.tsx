import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EcuadorianCedulaInput } from "./EcuadorianCedulaInput";

it("keeps identification as text including initial zeros and exposes accessible validation", () => {
  const onChange = vi.fn();
  render(<><label htmlFor="test-cedula">Cédula</label><EcuadorianCedulaInput id="test-cedula" onChange={onChange} aria-invalid="true" aria-describedby="cedula-error"/><p id="cedula-error">Revisa la cédula</p></>);
  const input = screen.getByLabelText("Cédula");
  expect(input).toHaveAttribute("type", "text");
  expect(input).toHaveAttribute("inputmode", "numeric");
  fireEvent.change(input, { target: { value: "0123456782" } });
  expect(input).toHaveValue("0123456782");
  expect(onChange).toHaveBeenCalledOnce();
  expect(input).toHaveAccessibleDescription("Revisa la cédula");
});
it("does not silently strip pasted invalid characters into another identification", () => {
  render(<EcuadorianCedulaInput aria-label="Cédula"/>);
  const input = screen.getByLabelText("Cédula");
  fireEvent.change(input, { target: { value: "01234x6782" } });
  expect(input).toHaveValue("01234x6782");
});
