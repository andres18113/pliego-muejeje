import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BuildUpdateNotice } from "./BuildUpdateNotice";
import { fetchPublishedBuildId, versionCheckInterval, watchBuildVersion, type VersionEnvironment } from "./buildVersion";

function environment(running: string | null, published: (string | null)[]) {
  const listeners = new Map<string, (() => void)[]>();
  let clock = 0;
  const fetchPublished = vi.fn(async () => published.length > 1 ? published.shift()! : published[0]);
  const env: VersionEnvironment = {
    running, fetchPublished, now: () => clock,
    listen: (event, listener) => { listeners.set(event, [...listeners.get(event) ?? [], listener]); return () => undefined; },
  };
  return { env, fetchPublished, emit: (event: string) => { for (const listener of listeners.get(event) ?? []) listener(); }, advance: (ms: number) => { clock += ms; } };
}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("build version check", () => {
  it("reads only a well-formed JSON build ID, never an HTML fallback or a failure", async () => {
    const reply = (body: string, type: string, status = 200) => async () => new Response(body, { status, headers: { "Content-Type": type } });
    expect(await fetchPublishedBuildId(reply('{"buildId":"20261104T120000Z-abc1234"}', "application/json") as typeof fetch)).toBe("20261104T120000Z-abc1234");
    expect(await fetchPublishedBuildId(reply("<!doctype html>", "text/html") as typeof fetch)).toBeNull();
    expect(await fetchPublishedBuildId(reply('{"buildId":"../x y"}', "application/json") as typeof fetch)).toBeNull();
    expect(await fetchPublishedBuildId(reply("{}", "application/json", 404) as typeof fetch)).toBeNull();
    expect(await fetchPublishedBuildId((async () => { throw new TypeError("offline"); }) as typeof fetch)).toBeNull();
  });

  it("reports a newer build once, on start or when the tab comes back, at most once per interval", async () => {
    const { env, fetchPublished, emit, advance } = environment("old", ["old", "new"]);
    const onNewer = vi.fn();
    watchBuildVersion(env, onNewer);
    await settle();
    expect(onNewer).not.toHaveBeenCalled();
    emit("visible");
    await settle();
    expect(fetchPublished).toHaveBeenCalledTimes(1);
    advance(versionCheckInterval);
    emit("visible");
    await settle();
    expect(onNewer).toHaveBeenCalledWith("new");
    advance(versionCheckInterval);
    emit("pageshow");
    await settle();
    expect(onNewer).toHaveBeenCalledTimes(1);
  });

  it("is inert without a stamped build (development, tests)", async () => {
    const { env, fetchPublished } = environment(null, ["new"]);
    watchBuildVersion(env, vi.fn());
    await settle();
    expect(fetchPublished).not.toHaveBeenCalled();
  });

  it("offers the update in the shared snackbar and reloads only when asked", async () => {
    const { env, fetchPublished } = environment("old", ["new"]);
    const reload = vi.fn();
    const factory = () => env;
    const { rerender, container } = render(<BuildUpdateNotice environment={factory} reload={reload} />);
    // Before a newer build is known, nothing (no empty live region) is on the page.
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(await screen.findByText("Hay una versión nueva de PLIEGO.")).toBeInTheDocument();
    rerender(<BuildUpdateNotice environment={factory} reload={() => reload()} />);
    await settle();
    // A new reload function on re-render must not restart the watcher (it would check again at once).
    expect(fetchPublished).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Actualizar" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
