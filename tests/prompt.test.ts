import { describe, expect, it } from "vitest";
import { normalizeToUiTree, fixtureBundle } from "../src/normalize.js";
import { generatePrompt } from "../src/prompt.js";

describe("generatePrompt", () => {
  it("includes source metadata, node summary, and warnings", () => {
    const document = normalizeToUiTree(
      fixtureBundle("fixture.json", {
        id: "root",
        name: "Root",
        type: "frame",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        children: [{ id: "label", type: "text", x: 10, y: 10, width: 80, height: 20, text: "Start", fontSize: 14, color: "#000000" }]
      })
    );
    const prompt = generatePrompt(document);
    expect(prompt).toContain("UI Implementation Prompt");
    expect(prompt).toContain("fixture.json");
    expect(prompt).toContain("Start");
    expect(prompt).toContain("#000000");
  });

  it("surfaces gradient, radius, and spacing facts for implementation", () => {
    const document = normalizeToUiTree(
      fixtureBundle("fixture.json", {
        id: "root",
        name: "Root",
        type: "frame",
        width: 200,
        height: 100,
        children: [
          { id: "first", name: "First", type: "shape", x: 10, y: 10, width: 40, height: 20, radius: [8], fill: "linear-gradient(180deg, #fff 0%, #000 100%)" },
          { id: "second", name: "Second", type: "shape", x: 60, y: 10, width: 40, height: 20 }
        ]
      })
    );
    const prompt = generatePrompt(document);
    expect(prompt).toContain("Gradients: linear-gradient(180deg, #fff 0%, #000 100%)");
    expect(prompt).toContain("Radii: 8");
    expect(prompt).toContain("Flow spacing gaps: 10");
    expect(prompt).toContain("radius=8");
  });

  it("instructs consumers to keep text intrinsic and reflow multiline content", () => {
    const document = normalizeToUiTree(
      fixtureBundle("fixture.json", {
        id: "root",
        type: "frame",
        width: 100,
        height: 100,
        children: [
          { id: "label", type: "text", width: 60, height: 14, text: "Dynamic", fontSize: 14 },
          { id: "content", type: "shape", y: 24, width: 60, height: 20 }
        ]
      })
    );
    const prompt = generatePrompt(document);
    expect(prompt).toContain("Keep text intrinsically sized");
    expect(prompt).toContain("dynamic or multiline text reflow");
    expect(prompt).toContain("Text-bound reference gaps: 10");
    expect(prompt).toContain("textSizing=intrinsic/reflow");
  });

});
