import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/app/(auth)/login/login-form";

const replace = vi.fn();
const refresh = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/use-require-auth", () => ({
  useRedirectIfAuthenticated: () => ({
    user: null,
    loading: false,
    error: null,
    configured: true,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithPassword },
  }),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    replace.mockReset();
    refresh.mockReset();
    signInWithPassword.mockReset();
    signInWithPassword.mockResolvedValue({
      error: new Error("browser auth must not be used"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "用户名或密码错误" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  it("does not offer public account registration", () => {
    render(<LoginForm />);

    expect(
      screen.queryByRole("link", { name: "立即注册" }),
    ).not.toBeInTheDocument();
  });

  it("creates the session through the same-origin login endpoint", async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("用户名"), {
      target: { value: "mislw" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/auth/login",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: "mislw",
            password: "correct-password",
          }),
        }),
      );
    });

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "用户名或密码错误",
    );
  });
});
