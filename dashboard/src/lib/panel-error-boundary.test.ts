import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PanelErrorBoundary } from "../components/PanelErrorBoundary";

describe("PanelErrorBoundary", () => {
  it("renders healthy content and preserves the panel's accessible attributes", () => {
    const boundary = new PanelErrorBoundary({
      children: createElement("p", null, "Healthy panel"),
      id: "drawer-tabpanel",
      role: "tabpanel",
      "aria-labelledby": "drawer-tab-overview",
    });

    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain("Healthy panel");
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="drawer-tab-overview"');
    expect(html).not.toContain('role="alert"');
  });

  it("replaces failed content with an accessible inline fallback", () => {
    const boundary = new PanelErrorBoundary({
      children: createElement("p", null, "Panel contents"),
    });
    boundary.state = PanelErrorBoundary.getDerivedStateFromError();

    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain('role="alert"');
    expect(html).toContain("This panel failed to load");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Panel contents");
  });

  it("requests recovery when Retry is clicked", () => {
    const boundary = new PanelErrorBoundary({ children: null });
    boundary.state = PanelErrorBoundary.getDerivedStateFromError();
    const setState = vi.spyOn(boundary, "setState").mockImplementation(() => {});
    const fallback = boundary.render().props.children;
    expect(isValidElement<{ children: ReactNode }>(fallback)).toBe(true);
    if (!isValidElement<{ children: ReactNode }>(fallback)) throw new Error("Missing fallback");

    const button = Children.toArray(fallback.props.children).find(
      (child) => isValidElement(child) && child.type === "button"
    );
    expect(isValidElement<{ onClick: () => void }>(button)).toBe(true);
    if (!isValidElement<{ onClick: () => void }>(button)) throw new Error("Missing Retry button");

    button.props.onClick();
    expect(setState).toHaveBeenCalledWith({ failed: false });
  });
});
