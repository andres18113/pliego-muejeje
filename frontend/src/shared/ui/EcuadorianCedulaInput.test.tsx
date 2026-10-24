import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { EcuadorianCedulaInput, identificationInputRejections } from "./EcuadorianCedulaInput";

function Controlled({ onRejected = vi.fn(), initial = "" }: { onRejected?: (reason: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><label htmlFor="id-field">Cédula o RUC</label>
    <EcuadorianCedulaInput id="id-field" value={value} onChange={event => setValue(event.target.value)} onInputRejected={onRejected} /></>;
}

it("is a numeric text field limited to 13 characters that keeps initial zeros", async () => {
  render(<Controlled />);
  const input = screen.getByLabelText("Cédula o RUC");
  expect(input).toHaveAttribute("type", "text");
  expect(input).toHaveAttribute("inputmode", "numeric");
  expect(input).toHaveAttribute("maxlength", "13");
  await userEvent.type(input, "0102030400");
  expect(input).toHaveValue("0102030400");
});

it("refuses a 14th digit and says why, keeping the 13 accepted", async () => {
  const rejected = vi.fn();
  render(<Controlled onRejected={rejected} />);
  const input = screen.getByLabelText("Cédula o RUC");
  await userEvent.type(input, "17900169190019");
  expect(input).toHaveValue("1790016919001");
  expect(rejected).toHaveBeenLastCalledWith(identificationInputRejections.length);
});

it("allows replacing selected digits even at the limit", async () => {
  const rejected = vi.fn();
  render(<Controlled onRejected={rejected} initial="1790016919001" />);
  const input = screen.getByLabelText("Cédula o RUC") as HTMLInputElement;
  input.setSelectionRange(10, 13);
  await userEvent.type(input, "002", { initialSelectionStart: 10, initialSelectionEnd: 13 });
  expect(input).toHaveValue("1790016919002");
  expect(rejected).not.toHaveBeenCalled();
});

it.each(["a", " ", "-", ".", "+", "é"])("refuses typing %j without changing the accepted value", async key => {
  const rejected = vi.fn();
  render(<Controlled onRejected={rejected} initial="17100" />);
  const input = screen.getByLabelText("Cédula o RUC");
  await userEvent.type(input, key);
  expect(input).toHaveValue("17100");
  expect(rejected).toHaveBeenCalledWith(identificationInputRejections.digits);
});

it("keeps only the digits of a number pasted with spaces, dots or dashes", async () => {
  render(<Controlled />);
  const input = screen.getByLabelText("Cédula o RUC");
  await userEvent.click(input);
  await userEvent.paste(" 179-001.6919 001 ");
  expect(input).toHaveValue("1790016919001");
});

it.each([["17900169190011", identificationInputRejections.length], ["17100x4065", identificationInputRejections.digits], ["+593 991234567", identificationInputRejections.digits]])(
  "refuses pasting %j as a whole and never truncates it", async (text, reason) => {
    const rejected = vi.fn();
    render(<Controlled onRejected={rejected} initial="17" />);
    const input = screen.getByLabelText("Cédula o RUC");
    await userEvent.click(input);
    await userEvent.paste(text);
    expect(input).toHaveValue("17");
    expect(rejected).toHaveBeenCalledWith(reason);
  });

it("refuses a paste that would only exceed the limit together with the digits already typed", async () => {
  const rejected = vi.fn();
  render(<Controlled onRejected={rejected} initial="1710034065" />);
  const input = screen.getByLabelText("Cédula o RUC");
  await userEvent.click(input);
  await userEvent.paste("0010");
  expect(input).toHaveValue("1710034065");
  expect(rejected).toHaveBeenCalledWith(identificationInputRejections.length);
});

it("reverts any other edit (autofill, assistive input) that breaks the rules", () => {
  const rejected = vi.fn();
  render(<Controlled onRejected={rejected} initial="17100" />);
  const input = screen.getByLabelText("Cédula o RUC");
  fireEvent.change(input, { target: { value: "17100abc" } });
  expect(input).toHaveValue("17100");
  fireEvent.change(input, { target: { value: "17100340650011" } });
  expect(input).toHaveValue("17100");
  expect(rejected).toHaveBeenCalledTimes(2);
  fireEvent.change(input, { target: { value: "1710034065" } });
  expect(input).toHaveValue("1710034065");
});

it("works uncontrolled, as react-hook-form registers it", async () => {
  const changed = vi.fn();
  render(<EcuadorianCedulaInput aria-label="Cédula o RUC" defaultValue="" onChange={changed} />);
  const input = screen.getByLabelText("Cédula o RUC");
  await userEvent.type(input, "1x7");
  expect(input).toHaveValue("17");
  await userEvent.click(input);
  await userEvent.paste("10 034 065");
  expect(input).toHaveValue("1710034065");
  expect(changed).toHaveBeenCalled();
});

it("stays silent and unchanged when read-only", async () => {
  const rejected = vi.fn();
  render(<EcuadorianCedulaInput aria-label="Cédula o RUC" readOnly value="1710034065" onInputRejected={rejected} onChange={() => undefined} />);
  const input = screen.getByLabelText("Cédula o RUC");
  await userEvent.type(input, "a1");
  await userEvent.paste("123");
  expect(input).toHaveValue("1710034065");
  expect(rejected).not.toHaveBeenCalled();
});
