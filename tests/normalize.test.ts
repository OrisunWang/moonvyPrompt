import { describe, expect, it } from "vitest";
import { fixtureBundle, inferLayoutHints, inferSiblingSpacing, normalizeToUiTree } from "../src/normalize.js";

describe("normalizeToUiTree", () => {
  it("preserves source hierarchy and computes relative bounds", () => {
    const source = {
      id: "root",
      name: "Root",
      type: "frame",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      children: [
        { id: "child", name: "Child", type: "shape", x: 20, y: 30, width: 80, height: 40, fill: "#ffffff", cornerRadius: 8 }
      ]
    };
    const document = normalizeToUiTree(fixtureBundle("fixture.json", source));
    expect(document.tree.children[0].relative).toMatchObject({ x: 20, y: 30, width: 80, height: 40 });
    expect(document.tokens.colors).toContain("#ffffff");
    expect(document.tokens.radius).toContain(8);
  });

  it("extracts text style facts into tokens", () => {
    const source = {
      id: "root",
      name: "Root",
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      children: [{ id: "text", type: "text", x: 10, y: 10, width: 100, height: 20, text: "Hello", fontSize: 16, fontWeight: 600, color: "#111111" }]
    };
    const document = normalizeToUiTree(fixtureBundle("fixture.json", source));
    expect(document.tree.children[0].text?.content).toBe("Hello");
    expect(document.tree.children[0].text?.layout).toEqual({ sizing: "intrinsic", boundsRole: "reference", overflow: "reflow" });
    expect(document.tokens.typography[0]).toMatchObject({ fontSize: 16, fontWeight: 600, color: "#111111" });
  });

  it("preserves Moonvy scalar and per-corner radius arrays", () => {
    const source = {
      id: "root",
      type: "frame",
      width: 200,
      height: 100,
      children: [
        { id: "uniform", type: "shape", width: 80, height: 40, radius: [10] },
        { id: "corners", type: "shape", x: 100, width: 80, height: 40, radius: [10, 0, 4, 2] }
      ]
    };
    const document = normalizeToUiTree(fixtureBundle("fixture.json", source));
    expect(document.tree.children[0].style?.radius).toBe(10);
    expect(document.tree.children[1].style?.radius).toEqual([10, 0, 4, 2]);
    expect(document.tokens.radius).toEqual([0, 2, 4, 10]);
  });

  it("normalizes Moonvy linear gradients and extracts their stop-color tokens", () => {
    const source = {
      id: "root",
      type: "frame",
      width: 100,
      height: 100,
      children: [{
        id: "gradient",
        type: "shape",
        width: 100,
        height: 100,
        fills: [{
          isEnabled: true,
          type: "gradient",
          gradient: {
            type: "linear",
            from: { x: 0.5, y: 0 },
            to: { x: 0.5, y: 1 },
            colorStops: [
              { position: 0, color: { value: "rgba(254,251,234,1)" } },
              { position: 1, color: { value: "rgba(255,247,212,1)" } }
            ]
          }
        }]
      }]
    };
    const document = normalizeToUiTree(fixtureBundle("fixture.json", source));
    const gradient = "linear-gradient(180deg, rgba(254,251,234,1) 0%, rgba(255,247,212,1) 100%)";
    expect(document.tree.children[0].style?.fill).toBe(gradient);
    expect(document.tokens.gradients).toEqual([gradient]);
    expect(document.tokens.colors).toEqual(["rgba(254,251,234,1)", "rgba(255,247,212,1)"]);
  });

});

describe("inferLayoutHints", () => {
  it("infers row direction and median gap", () => {
    const hints = inferLayoutHints(
      { x: 0, y: 0, width: 300, height: 80 },
      [
        { x: 10, y: 20, width: 50, height: 20 },
        { x: 70, y: 20, width: 50, height: 20 },
        { x: 130, y: 20, width: 50, height: 20 }
      ]
    );
    expect(hints.direction).toBe("row");
    expect(hints.gap).toBe(10);
    expect(hints.positioning).toBe("flow-inferred");
  });

  it("infers column direction", () => {
    const hints = inferLayoutHints(
      { x: 0, y: 0, width: 120, height: 220 },
      [
        { x: 10, y: 10, width: 80, height: 30 },
        { x: 10, y: 50, width: 80, height: 30 }
      ]
    );
    expect(hints.direction).toBe("column");
    expect(hints.gap).toBe(10);
  });
});

describe("inferSiblingSpacing", () => {
  it("marks text-bound gaps as reference-only while retaining anchor distance", () => {
    const nodes = [
      { id: "background", name: "Background", type: "shape" as const, bounds: { x: 0, y: 0, width: 200, height: 100 }, relative: { x: 0, y: 0, width: 200, height: 100 }, children: [] },
      { id: "avatar", name: "Avatar", type: "image" as const, bounds: { x: 16, y: 20, width: 24, height: 24 }, relative: { x: 16, y: 20, width: 24, height: 24 }, children: [] },
      { id: "name", name: "Name", type: "text" as const, bounds: { x: 46, y: 26, width: 48, height: 12 }, relative: { x: 46, y: 26, width: 48, height: 12 }, children: [] }
    ];
    expect(inferSiblingSpacing(nodes)).toContainEqual({
      axis: "horizontal",
      fromNodeId: "avatar",
      toNodeId: "name",
      sourceEdgeGap: 6,
      referenceAnchorDelta: 30,
      anchor: "leading-edge",
      usage: "reference-only"
    });
  });

  it("keeps non-text gaps available for direct flow layout", () => {
    const nodes = [
      { id: "first", name: "First", type: "shape" as const, bounds: { x: 10, y: 10, width: 20, height: 20 }, relative: { x: 10, y: 10, width: 20, height: 20 }, children: [] },
      { id: "second", name: "Second", type: "shape" as const, bounds: { x: 40, y: 10, width: 20, height: 20 }, relative: { x: 40, y: 10, width: 20, height: 20 }, children: [] }
    ];
    expect(inferSiblingSpacing(nodes)).toContainEqual({
      axis: "horizontal",
      fromNodeId: "first",
      toNodeId: "second",
      sourceEdgeGap: 10,
      referenceAnchorDelta: 30,
      anchor: "leading-edge",
      usage: "layout-spacing"
    });
  });

  it("separates text-bound reference gaps from flow spacing tokens", () => {
    const document = normalizeToUiTree(fixtureBundle("fixture.json", {
      id: "root",
      type: "frame",
      width: 100,
      height: 100,
      children: [
        { id: "label", type: "text", x: 0, y: 0, width: 60, height: 14, text: "Dynamic", fontSize: 14 },
        { id: "content", type: "shape", x: 0, y: 24, width: 60, height: 20 }
      ]
    }));
    expect(document.tree.layoutHints?.gapUsage).toBe("reference-only");
    expect(document.tokens.referenceSpacing).toContain(10);
    expect(document.tokens.spacing).not.toContain(10);
  });
});
