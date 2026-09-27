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
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "No pudimos mostrar esta página." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PLIEGO, ir al catálogo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al catálogo" })).toBeInTheDocument();
    expect(screen.queryByText("private implementation detail")).not.toBeInTheDocument();
  });
});
