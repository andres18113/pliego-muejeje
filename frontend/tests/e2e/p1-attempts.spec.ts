import { expect, test } from "@playwright/test";

test("native Web Locks serialize address creation claims across tabs and preserve the winning recovery key", async ({ context, page }) => {
  await context.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 204 }));
  const other = await context.newPage();
  await Promise.all([page.goto("/sign-in"), other.goto("/sign-in")]);
  const claim = (tab: typeof page) => tab.evaluate(async () => {
    const { beginPendingAttempt } = await import(String("/src/shared/api/attemptStorage.ts"));
    return beginPendingAttempt("address", "cross-tab-regression");
  });
  const replies = await Promise.allSettled([claim(page), claim(other)]);
  expect(replies.filter((reply) => reply.status === "fulfilled")).toHaveLength(1);
  expect(replies.filter((reply) => reply.status === "rejected")).toHaveLength(1);
  const winner = replies.find((reply) => reply.status === "fulfilled") as PromiseFulfilledResult<string>;
  await page.reload();
  for (const tab of [page, other]) {
    expect(await tab.evaluate(async () => {
      const { readPendingAttempt } = await import(String("/src/shared/api/attemptStorage.ts"));
      return readPendingAttempt("address", "cross-tab-regression");
    })).toBe(winner.value);
  }
});
