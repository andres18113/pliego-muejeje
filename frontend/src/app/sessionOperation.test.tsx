import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import { SessionProvider } from "./session";
import { useSessionOperationScope } from "./sessionOperation";

it("does not revive a departed operation when navigation returns to the same resource", () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>
    <SessionProvider restoreOnMount={false}>{children}</SessionProvider>
  </QueryClientProvider>;
  const { result, rerender, unmount } = renderHook(({ resource }) => useSessionOperationScope(resource),
    { wrapper, initialProps: { resource: "order-A" } });
  const departed = result.current;
  expect(departed.isCurrent()).toBe(true);
  rerender({ resource: "order-B" });
  expect(departed.isCurrent()).toBe(false);
  rerender({ resource: "order-A" });
  expect(result.current.isCurrent()).toBe(true);
  expect(departed.isViewCurrent()).toBe(false);
  expect(departed.isCurrent()).toBe(false);
  unmount();
  expect(result.current.isViewCurrent()).toBe(false);
});
