import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

globalThis.React = React;

import { HarnessEmbed } from "@/components/harness/harness-embed";

describe("HarnessEmbed", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads a server-issued iframe URL with the required bootstrap request and frame attributes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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

    expect(fetchSpy).toHaveBeenCalledWith("/api/harness/bootstrap", {
      method: "POST",
      cache: "no-store",
    });

    await waitFor(() => {
      const frame = screen.getByTitle("DeepSeek Harness");
      expect(frame).toHaveAttribute(
        "src",
        "https://agent.mislw.cn/auth/bootstrap?token=x",
      );
      expect(frame).toHaveAttribute(
        "allow",
        "clipboard-read; clipboard-write",
      );
      expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(frame).toHaveClass("h-full", "w-full", "border-0");
      expect(frame.closest("section")).toHaveClass(
        "fixed",
        "inset-y-0",
        "left-0",
        "right-0",
        "h-svh",
        "bg-background",
        "md:left-[240px]",
        "lg:left-[256px]",
      );
    });
  });

  it("keeps the iframe unmounted while bootstrap is loading", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));

    render(<HarnessEmbed />);

    expect(screen.getByLabelText("加载中")).toBeInTheDocument();
    expect(screen.queryByTitle("DeepSeek Harness")).not.toBeInTheDocument();
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

  it("uses the fallback error for non-JSON bootstrap failures and retries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );

    render(<HarnessEmbed />);

    expect(await screen.findByText("无法启动 AI 助手")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
