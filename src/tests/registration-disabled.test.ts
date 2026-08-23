// @vitest-environment node

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

describe("registration access", () => {
  it("redirects the public registration page to login", () => {
    const response = middleware(
      new NextRequest("http://localhost/register"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });
});
