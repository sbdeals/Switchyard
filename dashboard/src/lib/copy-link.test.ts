import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { CopyLinkButton } from "../components/service/CopyLinkButton";

const mocks = vi.hoisted(() => ({ useState: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: mocks.useState,
}));

type Button = ReactElement<{ children: ReactNode[]; onClick: () => Promise<void> }>;
type Status = ReactElement<{ children: string; role: string }>;

// Keep state between explicit renders while executing the actual click handler
// and saved-flash hook. Browser proof covers the native clipboard integration.
function mount() {
  const location = { href: "http://localhost:3067/?service=app&tab=logs#canvas" };
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
  vi.stubGlobal("window", { location });
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const states: unknown[] = [];
  let index = 0;
  mocks.useState.mockImplementation((initial: unknown) => {
    const slot = index++;
    if (!(slot in states)) states[slot] = initial;
    return [states[slot], (value: unknown) => { states[slot] = value; }];
  });

  function render() {
    index = 0;
    const tree = CopyLinkButton();
    const [button, status] = tree.props.children as [Button, false | Status];
    return {
      click: button.props.onClick,
      label: button.props.children[1],
      status: status ? status.props : null,
    };
  }
  return { location, writeText, render };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Copy link", () => {
  it("copies the exact current URL at click time, including query and hash", async () => {
    const button = mount();
    const initial = button.render();
    expect(initial.label).toBe("Copy link");
    button.location.href = "http://localhost:3067/?filter=a&service=app%2Fone&tab=settings#canvas";
    await initial.click();
    expect(button.writeText).toHaveBeenCalledExactlyOnceWith(button.location.href);
    expect(button.render()).toMatchObject({ label: "Copied!", status: null });
  });

  it("reports success only after the clipboard operation resolves", async () => {
    const button = mount();
    let resolve!: () => void;
    button.writeText.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const pending = button.render().click();
    expect(button.render()).toMatchObject({ label: "Copy link", status: null });
    resolve();
    await pending;
    expect(button.render()).toMatchObject({ label: "Copied!", status: null });
    vi.advanceTimersByTime(1800);
    expect(button.render().label).toBe("Copy link");
  });

  it("shows an accessible fallback when clipboard permission is denied", async () => {
    const button = mount();
    button.writeText.mockRejectedValue(new Error("Permission denied"));
    await button.render().click();
    expect(button.render()).toMatchObject({
      label: "Copy link",
      status: { role: "status", children: "Copy the URL from your address bar." },
    });
  });

  it("shows the fallback when the clipboard API is unavailable", async () => {
    const button = mount();
    vi.stubGlobal("navigator", {});
    await button.render().click();
    expect(button.writeText).not.toHaveBeenCalled();
    expect(button.render()).toMatchObject({
      label: "Copy link",
      status: { role: "status", children: "Copy the URL from your address bar." },
    });
  });

  it("clears a prior failure after a successful retry", async () => {
    const button = mount();
    button.writeText.mockRejectedValueOnce(new Error("Permission denied"));
    await button.render().click();
    expect(button.render().status).not.toBeNull();
    await button.render().click();
    expect(button.render()).toMatchObject({ label: "Copied!", status: null });
  });
});
