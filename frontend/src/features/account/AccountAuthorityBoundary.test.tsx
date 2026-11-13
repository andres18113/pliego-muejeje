import type { ReactNode } from "react";
import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/app/session";
import { AddressForm } from "@/features/purchase/AddressForm";
import { readPendingAttempt } from "@/shared/api/attemptStorage";
import type { CustomerProfile } from "@/shared/api/customer";
import { json, renderPurchaseRoute, stubApi, choosePlace } from "@/test/purchase";
import { AccountPage } from "@/features/account/AccountPage";
import { restoredProfileField, useProfileDraft } from "@/features/account/profileDraft";

const profileA: CustomerProfile = {
  customerId: "2", email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez",
  phone: null, state: "ACTIVE", version: "0",
};
const profileB: CustomerProfile = {
  ...profileA, customerId: "3", email: "bea@example.com", firstNames: "Bea", version: "1",
};
const draftKey = "pliego-profile-draft:2:firstNames";

function SwitchAccount({ children }: { children: ReactNode }) {
  const { establish } = useSession();
  return <>
    <button onClick={() => establish({
      accessToken: "token-B", expiresAt: Date.now() + 1_800_000,
      user: { userId: "3", email: profileB.email, role: "CUSTOMER" },
    })}>Cambiar a Bea</button>
    {children}
  </>;
}

describe("account command authority boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not send Ana's address using Bea's credentials after waiting for an attempt lock", async () => {
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const lockName = "pliego:claim:address:2";
    const holder = navigator.locks.request(lockName, async () => {
      acquired();
      await held;
    });
    await ready;
    const onSaved = vi.fn();
    const api = stubApi({ "POST /api/v1/me/addresses": () => json({ addressId: "20" }, 201) });
    const states = vi.fn();
    renderPurchaseRoute([{ path: "/form", element: <SwitchAccount>
      <AddressForm firstAddress onSaved={onSaved} onUncertain={() => {}} onSessionExpired={() => {}}
        onStateChange={states} />
    </SwitchAccount> }], "/form");
    const user = userEvent.setup();
    try {
      await user.type(await screen.findByLabelText("Dirección", { exact: true }), "Casa privada de Ana");
      await choosePlace(document.querySelector<HTMLElement>(".address-form")!);
      await user.type(screen.getByLabelText("Teléfono de contacto"), "0991234567");
      await user.click(screen.getByRole("button", { name: "Guardar dirección" }));
      await waitFor(() => expect(states).toHaveBeenLastCalledWith(expect.objectContaining({ busy: true })));
      await user.click(screen.getByRole("button", { name: "Cambiar a Bea" }));
      await act(async () => {
        release();
        await holder;
        // Drain the attempted claim before checking that its continuation was cancelled.
        await navigator.locks.request(lockName, () => {});
      });
      expect(api.count("POST", "/api/v1/me/addresses")).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(readPendingAttempt("address", "3")).toBeNull();
    } finally {
      release();
      await holder;
    }
  });

  it("does not refetch Bea's profile or restore Ana's erased draft when Ana's pending save completes", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const api = stubApi({
      "GET /api/v1/me": request => json(request.headers.get("Authorization") === "Bearer token-B" ? profileB : profileA),
      "PATCH /api/v1/me": () => pending,
    });
    renderPurchaseRoute([{ path: "/account", element: <SwitchAccount><AccountPage /></SwitchAccount> }], "/account");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar nombres" }));
    const input = screen.getByLabelText("Nombres", { exact: true });
    await user.clear(input);
    await user.type(input, "Ana María");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.count("PATCH", "/api/v1/me")).toBe(1));
    await user.clear(input);
    await user.type(input, "Ana Elena");
    expect(JSON.parse(sessionStorage.getItem(draftKey)!).value).toBe("Ana Elena");
    await user.click(screen.getByRole("button", { name: "Cambiar a Bea" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Perfil y datos personales" })).getByText(profileB.email)).toBeInTheDocument());
    expect(sessionStorage.getItem(draftKey)).toBeNull();
    expect(restoredProfileField(profileA.customerId)).toBeNull();
    // The save lock reports completion even when its originating editor was unmounted.
    let removeListener = () => {};
    const completed = new Promise<void>(resolve => {
      const listener = (event: Event) => {
        if ((event as CustomEvent<string>).detail === draftKey) resolve();
      };
      window.addEventListener("pliego-profile-save", listener);
      removeListener = () => window.removeEventListener("pliego-profile-save", listener);
    });
    try {
      await act(async () => {
        finish(new Response(null, { status: 204 }));
        await pending;
        await completed;
      });
      expect(sessionStorage.getItem(draftKey)).toBeNull();
      expect(restoredProfileField(profileA.customerId)).toBeNull();
      expect(api.calls.filter(call => call.method === "GET" && call.path === "/api/v1/me").length).toBe(2);
      expect(within(screen.getByRole("region", { name: "Perfil y datos personales" })).getByText(profileB.email)).toBeInTheDocument();
      expect(screen.queryByText("Guardamos tus nombres.")).not.toBeInTheDocument();
    } finally {
      removeListener();
      finish(new Response(null, { status: 204 }));
    }
  });

  it("preserves a draft when completion supplies another customer's profile", () => {
    const { result } = renderHook(() => useProfileDraft(profileA, "firstNames", profileA.firstNames));
    act(() => result.current.setValue("Ana María"));
    act(() => result.current.setValue("Ana Elena"));
    let accepted = true;
    act(() => { accepted = result.current.complete("Ana María", profileB); });
    expect(accepted).toBe(false);
    const stored = JSON.parse(sessionStorage.getItem(draftKey)!);
    expect(stored.value).toBe("Ana Elena");
    expect(stored.original).toEqual(profileA);
    expect(result.current.value).toBe("Ana Elena");
  });
});
