import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

globalThis.React = React;

vi.mock("@/lib/local-toolbox/client", () => ({
  LOCAL_TOOLBOX_ORIGIN: "http://127.0.0.1:37654",
  getLocalToolboxOrigin: vi.fn(() => "http://127.0.0.1:49152"),
  getLocalToolboxHealth: vi.fn(),
}));

import ToolboxPage from "@/app/(app)/toolbox/page";
import { getLocalToolboxHealth } from "@/lib/local-toolbox/client";

describe("toolbox page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the local extractor as offline without an upload fallback", async () => {
    vi.mocked(getLocalToolboxHealth).mockRejectedValue(new Error("offline"));

    render(<ToolboxPage />);

    expect(await screen.findByText("本机助手未启动")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试连接" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开解压小工具" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/上传/)).not.toBeInTheDocument();
  });

  it("opens the helper without forwarding a password or file", async () => {
    vi.mocked(getLocalToolboxHealth).mockResolvedValue({
      ok: true,
      version: 1,
      winRarAvailable: true,
      sevenZipAvailable: true,
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<ToolboxPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "打开解压小工具" }),
    );

    expect(open).toHaveBeenCalledWith(
      "http://127.0.0.1:49152/",
      "local-toolbox",
      expect.any(String),
    );
  });

  it("reports a connected helper without WinRAR", async () => {
    vi.mocked(getLocalToolboxHealth).mockResolvedValue({
      ok: true,
      version: 1,
      winRarAvailable: false,
      sevenZipAvailable: false,
    });

    render(<ToolboxPage />);

    expect(await screen.findByText("未检测到解压引擎")).toBeInTheDocument();
  });
});
