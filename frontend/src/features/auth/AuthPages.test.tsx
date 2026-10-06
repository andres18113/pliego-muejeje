import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/app/session";
import { setApiAccessToken } from "@/shared/api/client";
import { login, register } from "@/shared/api/auth";
import { ApiRequestError } from "@/shared/api/errors";
import { RegisterPage, SignInPage } from "./AuthPages";

vi.mock("@/shared/api/auth", () => ({
  login: vi.fn(),
  register: vi.fn(),
}));

const mockLogin = vi.mocked(login);
const mockRegister = vi.mocked(register);

function renderAuth(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: "/sign-in", element: <SignInPage /> },
    { path: "/register", element: <RegisterPage /> },
    { path: "/", element: <h1>Catálogo</h1> },
    { path: "/catalog", element: <h1>Catálogo</h1> },
    { path: "/admin", element: <h1>Administración</h1> },
  ], { initialEntries: [initialEntry] });

  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider restoreOnMount={false}>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

function validLoginResponse() {
  return {
    accessToken: "token-de-prueba",
    tokenType: "Bearer",
    expiresInSeconds: 1800,
    user: { userId: "10", email: "ana@example.com", role: "CUSTOMER" as const },
  };
}

async function completeRegistration(user: ReturnType<typeof userEvent.setup>, phone = "") {
  await user.type(screen.getByLabelText("Nombres"), "Ana María");
  await user.type(screen.getByLabelText("Apellidos"), "O’Connor-Pérez");
  await user.type(screen.getByLabelText("Correo electrónico"), "  ANA@EXAMPLE.COM  ");
  await user.type(screen.getByLabelText("Contraseña"), "lecturaSegura123");
  if (phone) {
    await user.click(screen.getByRole("button", { name: "Añadir teléfono (opcional)" }));
    await user.type(screen.getByLabelText(/Teléfono/), phone);
  }
}

afterEach(() => {
  setApiAccessToken(null);
  vi.clearAllMocks();
});

describe("authentication forms", () => {
  it("turns an unverified sign-in into direction, carrying the address to the resend page", async () => {
    mockLogin.mockRejectedValueOnce(new ApiRequestError(403, "EMAIL_NOT_VERIFIED", "Verifica tu correo", "Abre el enlace que enviamos antes de iniciar sesión."));
    renderAuth("/sign-in");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "segura123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Verifica tu correo");
    expect(notice).toHaveAttribute("data-tone", "info");
    expect(within(notice).getByRole("link", { name: "Solicitar enlace de verificación" })).toHaveAttribute("href", "/reenviar-verificacion");
  });

  it("does not offer a verification link for wrong credentials", async () => {
    mockLogin.mockRejectedValueOnce(new ApiRequestError(401, "AUTH_INVALID_CREDENTIALS", "No autorizado", "Credenciales inválidas."));
    renderAuth("/sign-in");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "segura123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    const notice = await screen.findByRole("alert");
    expect(notice).not.toHaveAttribute("data-tone");
    expect(within(notice).queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers password recovery and verification resend without an account-existence claim", () => {
    renderAuth("/sign-in");
    expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveAttribute("href", "/recuperar-contrasena");
    expect(screen.getByRole("link", { name: "Reenviar verificación" })).toHaveAttribute("href", "/reenviar-verificacion");
  });

  it("asks a newly registered customer to verify their email before signing in", async () => {
    mockRegister.mockResolvedValue({ userId: "10", customerId: "21", state: "PENDING_VERIFICATION" });
    renderAuth("/register");
    const user = userEvent.setup();
    await completeRegistration(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByRole("heading", { name: "Revisa tu correo" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Verifica tu correo");
    expect(screen.getByRole("link", { name: "Reenviar verificación" })).toHaveAttribute("href", "/reenviar-verificacion");
  });

  it("requires a sign-in email and focuses its associated Spanish error", async () => {
    const user = userEvent.setup();
    renderAuth("/sign-in");

    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    const email = screen.getByLabelText("Correo electrónico");
    expect(await screen.findByText("Escribe tu correo electrónico.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-describedby", "sign-in-email-error");
    await waitFor(() => expect(email).toHaveFocus());
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("requires names after trimming and associates the error with the field", async () => {
    const user = userEvent.setup();
    renderAuth("/register");

    await user.type(screen.getByLabelText("Nombres"), "   ");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    const firstNames = screen.getByLabelText("Nombres");
    expect(await screen.findByText("Escribe tus nombres.")).toBeInTheDocument();
    expect(firstNames).toHaveAttribute("aria-invalid", "true");
    expect(firstNames).toHaveAttribute("aria-describedby", "register-first-names-error");
    await waitFor(() => expect(firstNames).toHaveFocus());
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("accepts trimmed single-character Unicode names within the API limits", async () => {
    const user = userEvent.setup();
    mockRegister.mockResolvedValue({ userId: "10", customerId: "21", state: "PENDING_VERIFICATION" });
    renderAuth("/register");

    await user.type(screen.getByLabelText("Nombres"), " 李 ");
    await user.type(screen.getByLabelText("Apellidos"), " 李 ");
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "lecturaSegura123");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith({
      firstNames: "李",
      lastNames: "李",
      email: "ana@example.com",
      password: "lecturaSegura123",
      phone: undefined,
    }));
    expect(await screen.findByRole("heading", { name: "Revisa tu correo" })).toBeInTheDocument();
  });

  it("accepts names exactly 120 characters long", async () => {
    const user = userEvent.setup();
    const firstNames = "a".repeat(120);
    const lastNames = "b".repeat(120);
    mockRegister.mockResolvedValue({ userId: "10", customerId: "21", state: "PENDING_VERIFICATION" });
    renderAuth("/register");

    fireEvent.change(screen.getByLabelText("Nombres"), { target: { value: firstNames } });
    fireEvent.change(screen.getByLabelText("Apellidos"), { target: { value: lastNames } });
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "lecturaSegura123");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith({
      firstNames,
      lastNames,
      email: "ana@example.com",
      password: "lecturaSegura123",
      phone: undefined,
    }));
  });

  it("rejects names longer than the API maximum of 120 characters", async () => {
    const user = userEvent.setup();
    renderAuth("/register");

    fireEvent.change(screen.getByLabelText("Nombres"), { target: { value: "a".repeat(121) } });
    await user.type(screen.getByLabelText("Apellidos"), "Pérez");
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "lecturaSegura123");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("Tus nombres no pueden superar 120 caracteres.")).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("enforces the password byte limit with human-readable Spanish copy", async () => {
    const user = userEvent.setup();
    renderAuth("/register");
    await completeRegistration(user);
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "😀".repeat(19) } });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("La contraseña es demasiado larga. Usa una más corta.")).toBeInTheDocument();
    expect(screen.queryByText(/bytes|UTF-8/i)).not.toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("rejects phone punctuation outside the backend normalization contract", async () => {
    const user = userEvent.setup();
    renderAuth("/register");
    await completeRegistration(user, "+593#25550134");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    const phone = screen.getByLabelText(/Teléfono/);
    expect(await screen.findByText("Usa solo dígitos, espacios, paréntesis, puntos o guiones; no incluyas letras ni extensiones.")).toBeInTheDocument();
    expect(phone).toHaveAttribute("aria-describedby", "register-phone-error");
    await waitFor(() => expect(phone).toHaveFocus());
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("normalizes names, email, and formatted phone before registering, then requires sign-in", async () => {
    const user = userEvent.setup();
    mockRegister.mockResolvedValue({ userId: "10", customerId: "21", state: "PENDING_VERIFICATION" });
    renderAuth("/register?from=%2F");
    await completeRegistration(user, "+593 (2) 555-0134");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith({
      firstNames: "Ana María",
      lastNames: "O’Connor-Pérez",
      email: "ana@example.com",
      password: "lecturaSegura123",
      phone: "+59325550134",
    }));
    expect(await screen.findByRole("heading", { name: "Revisa tu correo" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("La cuenta se creó correctamente");

    await user.click(within(screen.getByRole("main")).getByRole("link", { name: "Iniciar sesión" }));
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("ana@example.com");
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("shows invalid credentials without exposing backend detail", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValueOnce(new ApiRequestError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas", "AUTH_INVALID_CREDENTIALS"));
    renderAuth("/sign-in");
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
    await user.type(password, "claveincorrecta");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El correo o la contraseña no son correctos.");
    expect(alert).not.toHaveTextContent("AUTH_INVALID_CREDENTIALS");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(password.value).toBe("claveincorrecta");
  });

  it.each([
    ["network", new TypeError("Failed to fetch"), "No pudimos conectar con PLIEGO"],
    ["server", new ApiRequestError(503, "INTERNAL_ERROR", "Internal Server Error", "Database unavailable"), "El servicio no está disponible"],
  ])("distinguishes %s failures during sign-in", async (_kind, error, message) => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValueOnce(error);
    renderAuth("/sign-in");
    const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(password, "lecturaSegura123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(password.value).toBe("lecturaSegura123");
  });

  it("keeps sign-in pending controls focusable, blocks duplicate requests, and announces redirect", async () => {
    const user = userEvent.setup();
    let finishLogin: ((response: ReturnType<typeof validLoginResponse>) => void) | undefined;
    mockLogin.mockImplementation(() => new Promise((resolve) => {
      finishLogin = resolve;
    }));
    renderAuth("/sign-in");
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "lecturaSegura123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));

    const submit = screen.getByRole("button", { name: "Ingresando…" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
    submit.focus();
    expect(submit).toHaveFocus();
    await user.click(submit);
    expect(mockLogin).toHaveBeenCalledTimes(1);

    finishLogin?.(validLoginResponse());
    expect(await screen.findByText("Inicio de sesión correcto. Abriendo tu cuenta…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Catálogo" })).toBeInTheDocument();
  });
});
