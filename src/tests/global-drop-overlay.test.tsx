import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalDropOverlay } from "@/components/intake/global-drop-overlay";

globalThis.React = React;

const intake = vi.hoisted(() => ({ enqueueFiles: vi.fn() }));
vi.mock("@/components/intake/global-file-intake-provider", () => ({
  useGlobalFileIntake: () => intake,
}));

describe("GlobalDropOverlay", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens only for external file drags", () => {
    render(<GlobalDropOverlay />);

    fireEvent.dragEnter(window, fileDrag());
    expect(screen.getByText("交给 Hermes 整理")).toBeInTheDocument();

    fireEvent.dragLeave(window, fileDrag());
    fireEvent.dragEnter(window, {
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(screen.queryByText("交给 Hermes 整理")).not.toBeInTheDocument();
  });

  it("keeps the overlay open across nested drag enter and leave events", () => {
    render(<GlobalDropOverlay />);
    fireEvent.dragEnter(window, fileDrag());
    fireEvent.dragEnter(window, fileDrag());
    fireEvent.dragLeave(window, fileDrag());

    expect(screen.getByText("交给 Hermes 整理")).toBeInTheDocument();

    fireEvent.dragLeave(window, fileDrag());
    expect(screen.queryByText("交给 Hermes 整理")).not.toBeInTheDocument();
  });

  it("does not intercept a component marked as a local drop owner", () => {
    render(
      <div data-intake-drop-owner data-testid="local-owner">
        <GlobalDropOverlay />
      </div>,
    );

    fireEvent.drop(screen.getByTestId("local-owner"), fileDrag());

    expect(intake.enqueueFiles).not.toHaveBeenCalled();
  });

  it("enqueues dropped files without navigating the page", () => {
    const originalPath = window.location.pathname;
    render(<GlobalDropOverlay />);

    fireEvent.dragEnter(window, fileDrag());
    fireEvent.drop(window, fileDrag());

    expect(intake.enqueueFiles).toHaveBeenCalledWith(
      expect.objectContaining({ length: 1 }),
      "file_drop",
    );
    expect(window.location.pathname).toBe(originalPath);
  });
});

function fileDrag() {
  return {
    dataTransfer: {
      types: ["Files"],
      files: [new File(["x"], "x.md", { type: "text/markdown" })],
    },
  };
}
