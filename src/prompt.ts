import type { UiNode, UiTreeDocument } from "./types.js";

/** Builds the AI-facing implementation prompt from a normalized UI tree. */
export function generatePrompt(document: UiTreeDocument): string {
  const nodeSummary = summarizeNodes(document.tree).slice(0, 80).join("\n");
  const warnings = document.warnings.length > 0 ? document.warnings.map((warning) => `- [${warning.code}] ${warning.message}`).join("\n") : "- None";
  return [
    "# UI Implementation Prompt",
    "",
    "You are implementing a UI page from a normalized Moonvy design tree.",
    "",
    "## Source",
    "",
    `- Source URL: ${document.meta.sourceUrl}`,
    `- Page ID: ${document.meta.pageId}`,
    `- Source type: ${document.meta.sourceType}`,
    `- Confidence: ${document.meta.confidence}`,
    `- Canvas: ${document.meta.canvas.width} x ${document.meta.canvas.height} @1x`,
    "",
    "## Instructions",
    "",
    "- Use `ui-tree.json` as the layout source of truth.",
    "- Preserve absolute dimensions, relative offsets, colors, radius, shadows, and typography when present.",
    "- Use layout hints to choose flex/grid structure, but keep exact bounds as verification targets.",
    "- Keep text intrinsically sized. Never map a text node's source `bounds.height` to a fixed implementation height.",
    "- Let dynamic or multiline text reflow and move following content instead of clipping it to the source annotation bounds.",
    "- Use `sourceEdgeGap` as stack/flex spacing only when its relation has `usage: layout-spacing`; for `reference-only`, verify placement with `referenceAnchorDelta` instead.",
    "- Do not invent missing style facts. Treat warnings as uncertainty markers.",
    "- Reference downloaded assets by their local paths when an `asset.localPath` is present.",
    "",
    "## Downloaded Assets",
    "",
    "- 相同的素材不要重复添加。添加进 assets 前先检查现有素材，按内容复用；不同倍率属于同一个素材。",
    "- Read `assets/index.json` for layer mappings, PNG density variants, and SHA-256 hashes. PNG files are already extracted and ready to import; redundant ZIPs are removed after verification. If a legacy ZIP is retained with a cleanup warning, resolve the warning before deleting it.",
    "- Use each catalog entry’s `assetName` as the app asset name. It comes from the UI layer name; duplicate content reuses the first name and conflicting names receive numeric suffixes.",
    "- Slice logical size can differ from its containing layer bounds. Preserve the catalog size and density; do not stretch the slice to the full layer automatically.",
    ...(document.assets ?? []).map((asset) => `- ${asset.name} [${asset.nodeId}] (asset name: ${asset.assetName ?? asset.name}): ${asset.localPath}; ${asset.variants.map((variant) => `${variant.scale ? `@${variant.scale}x` : "original"}: ${variant.localPath}`).join(", ")}`),
    "",
    "## Design Tokens",
    "",
    `- Colors: ${document.tokens.colors.join(", ") || "none detected"}`,
    `- Gradients: ${document.tokens.gradients.join("; ") || "none detected"}`,
    `- Font sizes: ${[...new Set(document.tokens.typography.map((item) => item.fontSize).filter(Boolean))].join(", ") || "none detected"}`,
    `- Radii: ${document.tokens.radius.join(", ") || "none detected"}`,
    `- Flow spacing gaps: ${document.tokens.spacing.join(", ") || "none detected"}`,
    `- Text-bound reference gaps: ${document.tokens.referenceSpacing.join(", ") || "none detected"}`,
    "",
    "## Node Summary",
    "",
    nodeSummary || "- No nodes detected.",
    "",
    "## Warnings",
    "",
    warnings,
    ""
  ].join("\n");
}

/** Produces a compact, indented outline of the UI tree for prompt readability. */
function summarizeNodes(node: UiNode, depth = 0): string[] {
  const indent = "  ".repeat(depth);
  const text = node.text?.content ? ` text="${node.text.content}" textSizing=${node.text.layout.sizing}/${node.text.layout.overflow}` : "";
  const fill = node.style?.fill ? ` fill=${node.style.fill}` : "";
  const radius = node.style?.radius !== undefined ? ` radius=${JSON.stringify(node.style.radius)}` : "";
  const gap = node.layoutHints?.gap !== undefined ? ` gap=${node.layoutHints.gap}` : "";
  const spacing = summarizeSpacing(node);
  const line = `${indent}- ${node.type} ${node.name} (${node.bounds.x}, ${node.bounds.y}, ${node.bounds.width}x${node.bounds.height})${text}${fill}${radius}${gap}${spacing}`;
  return [line, ...node.children.flatMap((child) => summarizeNodes(child, depth + 1))];
}

/** Summarizes safe and reference-only relations separately so prompts do not promote text bounds to layout gaps. */
function summarizeSpacing(node: UiNode): string {
  const relations = node.layoutHints?.childSpacing ?? [];
  if (relations.length === 0) {
    return "";
  }
  const flowCount = relations.filter((relation) => relation.usage === "layout-spacing").length;
  const referenceCount = relations.length - flowCount;
  return ` childSpacing=flow:${flowCount}/reference:${referenceCount}`;
}
