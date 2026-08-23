import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(() => {
    throw new Error("Supabase client must not be created in preview mode");
  }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "preview-user", email: "preview@example.local" },
    loading: false,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient,
  isSupabaseBrowserConfigured: () => false,
}));

import { WorkspaceGreeting } from "@/components/workspace/greeting";

describe("WorkspaceGreeting preview mode", () => {
  beforeEach(() => {
    createClient.mockClear();
  });

  it("uses the preview email name without creating an unconfigured Supabase client", async () => {
    render(<WorkspaceGreeting />);

    expect(await screen.findByRole("heading")).toHaveTextContent("preview");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("keeps the Shin-chan character visible beside the workspace greeting", () => {
    const { container } = render(<WorkspaceGreeting />);
    const character = container.querySelector(
      'img[src*="shinchan-friends-clean"]',
    );

    expect(character).toBeInTheDocument();
    expect(character).toHaveAttribute("aria-hidden", "true");
  });
});
