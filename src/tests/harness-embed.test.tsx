import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

globalThis.React = React;

import { HarnessEmbed } from "@/components/harness/harness-embed";

describe("HarnessEmbed", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads a server-issued iframe URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          url: "https://agent.mislw.cn/auth/bootstrap?token=x",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    render(<HarnessEmbed />);

    await waitFor(() => {
      expect(screen.getByTitle("DeepSeek Harness")).toHaveAttribute(
        "src",
        "https://agent.mislw.cn/auth/bootstrap?token=x",
      );
    });
  });

  it("offers retry after a bootstrap failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "服务不可用" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<HarnessEmbed />);

    expect(await screen.findByText("服务不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
