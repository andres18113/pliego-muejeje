import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { BackNavigationContext } from "./BackNavigationContext";
import { BackButton } from "./BackButton";

it("goes back through the view's back navigation", () => {
  const goBack = vi.fn();
  const router = createMemoryRouter([{ path: "*", element: <BackNavigationContext.Provider value={{ canGoBack: true, fallback: "/", goBack }}><BackButton /></BackNavigationContext.Provider> }]);
  render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole("button", { name: "Volver atrás" }));
  expect(goBack).toHaveBeenCalledOnce();
});
it("hides the arrow at an isolated root", () => {
  const router = createMemoryRouter([{ path: "*", element: <BackButton /> }]);
  render(<RouterProvider router={router} />);
  expect(screen.queryByRole("button", { name: "Volver atrás" })).toBeNull();
});
