import { PliegoThemeProvider } from "@/theme/PliegoThemeProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SessionProvider } from "./session";
import { RouteErrorBoundary } from "./App";

function RouteCrash(): null {
  throw new Error("private implementation detail");
}

describe("RouteErrorBoundary", () => {
  it("recovers from a route render error with shared public chrome", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([
      { path: "/", element: <RouteCrash />, errorElement: <RouteErrorBoundary /> },
    ]);

    render(
      <PliegoThemeProvider><QueryClientProvider client={queryClient}>
        <SessionProvider restoreOnMount={false}>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider></PliegoThemeProvider>,
    );

    expect(await screen.findByRole("heading", { name: "No pudimos mostrar esta página." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PLIEGO, ir al inicio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Ir al catálogo" })).toBeNull();
    expect(screen.queryByText("private implementation detail")).not.toBeInTheDocument();
  });
});
