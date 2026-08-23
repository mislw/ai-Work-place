// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createServerClient, signInWithPassword } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return { ...actual, createServerClient };
});

import { POST } from "@/app/api/auth/login/route";

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://kong:8000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("LOGIN_USERNAME", "mislw");
    vi.stubEnv("LOGIN_EMAIL", "user@example.com");
    signInWithPassword.mockReset();
    createServerClient.mockReset();
    signInWithPassword.mockResolvedValue({
      data: {
        user: { id: "user-1" },
        session: { access_token: "test-token" },
      },
      error: null,
    });
    createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: {
          cookies: {
            setAll: (
              cookies: Array<{
                name: string;
                value: string;
                options: { path: string; sameSite: "lax" };
              }>,
            ) => void;
          };
        },
      ) => {
        options.cookies.setAll([
          {
            name: "sb-test-auth-token",
            value: "session-cookie",
            options: { path: "/", sameSite: "lax" },
          },
        ]);
        return { auth: { signInWithPassword } };
      },
    );
  });

  it("returns the session cookie on the exact success response", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "mislw",
          password: "correct-password",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createServerClient).toHaveBeenCalledWith(
      "http://kong:8000",
      "anon-key",
      expect.any(Object),
    );
    expect(createServerClient.mock.calls[0]?.[2]).toMatchObject({
      cookieOptions: { name: "sb-supabase-auth-token" },
    });
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe(
      "session-cookie",
    );
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "correct-password",
    });
  });

  it("rejects a username other than the configured single user", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "someone-else",
          password: "correct-password",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "用户名或密码错误" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
