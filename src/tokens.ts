import type { DesignTokens, ShadowStyle, UiNode } from "./types.js";

/** Extracts reusable design tokens from a normalized UI tree. */
export function extractTokens(root: UiNode): DesignTokens {
  const colors = new Set<string>();
  const gradients = new Set<string>();
  const typography = new Map<string, DesignTokens["typography"][number]>();
  const spacing = new Set<number>();
  const referenceSpacing = new Set<number>();
  const radius = new Set<number>();
  const shadows = new Set<string>();

  /** Visits a node and accumulates token facts from style, text, and layout hints. */
  function visit(node: UiNode): void {
    if (node.style?.fill) {
      if (isGradient(node.style.fill)) {
        gradients.add(node.style.fill);
        gradientColors(node.style.fill).forEach((color) => colors.add(color));
      } else {
        colors.add(node.style.fill);
      }
    }
    if (node.style?.stroke?.color) colors.add(node.style.stroke.color);
    if (typeof node.style?.radius === "number") radius.add(node.style.radius);
    if (Array.isArray(node.style?.radius)) node.style.radius.forEach((item) => radius.add(item));
    node.style?.shadow?.map(shadowToString).forEach((item) => shadows.add(item));
    if (node.text) {
      if (node.text.color) colors.add(node.text.color);
      const key = JSON.stringify({ fontFamily: node.text.fontFamily, fontSize: node.text.fontSize, fontWeight: node.text.fontWeight, color: node.text.color });
      typography.set(key, { fontFamily: node.text.fontFamily, fontSize: node.text.fontSize, fontWeight: node.text.fontWeight, color: node.text.color });
    }
    if (typeof node.layoutHints?.gap === "number" && node.layoutHints.gap >= 0) {
      const target = node.layoutHints.gapUsage === "reference-only" ? referenceSpacing : spacing;
      target.add(node.layoutHints.gap);
    }
    node.layoutHints?.childSpacing?.forEach((relation) => {
      const target = relation.usage === "reference-only" ? referenceSpacing : spacing;
      target.add(relation.sourceEdgeGap);
    });
    node.children.forEach(visit);
  }

  visit(root);
  return {
    colors: [...colors].sort(),
    gradients: [...gradients].sort(),
    typography: [...typography.values()].sort((a, b) => (a.fontSize ?? 0) - (b.fontSize ?? 0)),
    spacing: [...spacing].sort((a, b) => a - b),
    referenceSpacing: [...referenceSpacing].sort((a, b) => a - b),
    radius: [...radius].sort((a, b) => a - b),
    shadows: [...shadows].sort()
  };
}

/** Identifies normalized CSS gradient fills without conflating them with solid colors. */
function isGradient(fill: string): boolean {
  return /^(linear|radial|conic)-gradient\(/.test(fill);
}

/** Extracts CSS rgba/hex stop colors from a normalized gradient string. */
function gradientColors(gradient: string): string[] {
  return gradient.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi) ?? [];
}

/** Converts a shadow object into a compact CSS-like string token. */
function shadowToString(shadow: ShadowStyle): string {
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`;
}
