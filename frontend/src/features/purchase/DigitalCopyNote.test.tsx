import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { DigitalCopyNote, digitalCopyExplanation } from "./DigitalCopyNote";

function show(onOuterEscape = vi.fn()) {
  render(<PliegoThemeProvider>
    <div onKeyDown={(event) => { if (event.key === "Escape") onOuterEscape(); }}><DigitalCopyNote /></div>
    <button type="button">Otra acción</button>
  </PliegoThemeProvider>);
  return { info: screen.getByRole("button", { name: "Más información sobre la copia digital individual" }), onOuterEscape };
}

it("keeps a short visible label and gives the info button the rule as its description", () => {
  const { info } = show();
  expect(screen.getByText("Copia digital individual")).toBeVisible();
  expect(info).toHaveAccessibleDescription(digitalCopyExplanation);
  expect(info).toHaveAttribute("aria-expanded", "false");
});

it("opens on keyboard focus, closes with Escape without closing what contains it, and closes on leaving", async () => {
  const user = userEvent.setup();
  const { info, onOuterEscape } = show();
  await user.tab();
  expect(info).toHaveFocus();
  expect(info).toHaveAttribute("aria-expanded", "true");
  // The button controls the explanation it is described by; its visibility is checked in the browser
  // (tests/e2e/digital-single-copy.spec.ts), where the instant transition renders as it does for customers.
  expect(document.getElementById(info.getAttribute("aria-controls")!)).toHaveTextContent(digitalCopyExplanation);
  await user.keyboard("{Escape}");
  expect(info).toHaveAttribute("aria-expanded", "false");
  // The cart drawer around it must not close with the explanation.
  expect(onOuterEscape).not.toHaveBeenCalled();
  await user.tab();
  await user.tab({ shift: true });
  expect(info).toHaveAttribute("aria-expanded", "true");
  await user.tab();
  expect(info).toHaveAttribute("aria-expanded", "false");
});

it("a click or tap pins it open and a second press closes it", async () => {
  const user = userEvent.setup();
  const { info } = show();
  await user.click(info);
  expect(info).toHaveAttribute("aria-expanded", "true");
  await user.click(info);
  expect(info).toHaveAttribute("aria-expanded", "false");
});
