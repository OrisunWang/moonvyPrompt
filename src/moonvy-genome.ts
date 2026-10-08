import { upstreamError } from "./errors.js";
import type { PipelineWarning } from "./types.js";

/** Safely narrows records while excluding arrays, which have separate traversal rules. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Converts the official Genome pages[0] contract into the shared source-node representation. */
export function adaptGenome(value: unknown, warnings: PipelineWarning[], disk?: string, renameMap?: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.pages) || !isRecord(value.pages[0]) || !isRecord(value.pages[0].rect)) {
    throw upstreamError("MOONVY_INVALID_GENOME", "Genome has no usable design page.");
  }
  /** Genome owns the image table; explicit URLs take priority over the legacy project disk path. */
  const images = isRecord(value.images) ? value.images : {};
  /** Named style collections are flattened once so linked paints and typography retain their facts. */
  const styles = new Map<string, Record<string, unknown>>();
  if (isRecord(value.styles)) for (const list of Object.values(value.styles)) if (Array.isArray(list)) {
    for (const style of list) if (isRecord(style) && typeof style.id === "string") styles.set(style.id, style);
  }
  /** Resolves source image identifiers without treating a missing URL as export permission. */
  function imageUrl(id: unknown): string | undefined {
    if (typeof id !== "string") return undefined;
    const image = images[id];
    if (isRecord(image) && typeof image.url === "string" && /^https:\/\//.test(image.url)) return image.url;
    return disk ? `https://file-cn.moonvy.com/p/${encodeURIComponent(disk)}/c/md5/${encodeURIComponent(id)}` : undefined;
  }
  /** Adapter records unsupported source facts for review rather than silently inventing equivalent UI. */
  function warn(code: string, id: string, message: string): void {
    warnings.push({ code, severity: "degraded", message: `Layer ${id}: ${message}` });
  }
  /** Genome positions are relative to the nearest isFrame ancestor; groups share that coordinate space. */
  function visit(raw: Record<string, unknown>, frameX: number, frameY: number, root = false, index = "0"): Record<string, unknown> | undefined {
    const blend = isRecord(raw.blend) ? raw.blend : {};
    if (raw.visible === false || raw.isVisible === false || blend.visible === false) return undefined;
    /** Source id is stable; deterministic traversal ids only cover incomplete exports. */
    const id = typeof raw.id === "string" ? raw.id : `genome-${index}`;
    const rect = isRecord(raw.rect) ? raw.rect : {};
    const absolute = isRecord(raw.absoluteLayer) && isRecord(raw.absoluteLayer.rect) ? raw.absoluteLayer.rect : undefined;
    const x = root ? 0 : absolute ? numeric(absolute.x) ?? 0 : (numeric(rect.x) ?? 0) + frameX;
    const y = root ? 0 : absolute ? numeric(absolute.y) ?? 0 : (numeric(rect.y) ?? 0) + frameY;
    const width = numeric(absolute?.w) ?? numeric(rect.w) ?? 0;
    const height = numeric(absolute?.h) ?? numeric(rect.h) ?? 0;
    const linkedFill = typeof raw.fillLink === "string" ? styles.get(raw.fillLink)?.data : undefined;
    const linkedText = typeof raw.textLink === "string" ? styles.get(raw.textLink) : undefined;
    const textbox = { ...(isRecord(linkedText?.data) ? linkedText.data : {}), ...(isRecord(raw.textbox) ? raw.textbox : {}) };
    const segments = Array.isArray(textbox.segments) ? textbox.segments.filter(isRecord) : [];
    const segment = { ...(isRecord(linkedText?.segment) ? linkedText.segment : {}), ...segments[0] };
    const fills = paints(linkedFill ?? raw.fills, warnings, id);
    const fontName = isRecord(segment.fontName) ? segment.fontName : {};
    const stroke = Array.isArray(raw.strokes) ? raw.strokes.filter(isRecord).find(stroke => stroke.visible !== false) : undefined;
    const border = stroke ? paints(stroke.fills, warnings, id)[0] : undefined;
    const effectLink = typeof raw.effectLink === "string" ? styles.get(raw.effectLink)?.data : undefined;
    const effects = Array.isArray(effectLink ?? raw.effects) ? (effectLink ?? raw.effects) as unknown[] : [];
    const shadows = effects.filter(isRecord).filter(effect => effect.visible !== false && effect.type === "shadow");
    if (segments.length > 1) warn("GENOME_MIXED_TEXT_STYLES", id, "Text has multiple style runs; the tree records the first run and raw Genome retains all runs.");
    if (isRecord(raw.transform) && Object.values(raw.transform).some(value => value !== 0 && value !== false)) warn("GENOME_TRANSFORM_REFERENCE", id, "Transforms require review against the preview; geometry retains source rectangle references.");
    if (blend.isMask || blend.isClip) warn("GENOME_MASK_REFERENCE", id, "Mask/clipping behavior is retained in raw Genome and needs implementation review.");
    if (raw.varBind || raw._resolvedVariableModes) warn("GENOME_VARIABLE_REFERENCE", id, "Variable bindings require checking against resolved source values.");
    if (shadows.some(effect => effect.inset)) warn("GENOME_INSET_SHADOW_REFERENCE", id, "Inset shadow behavior requires manual review.");
    const slices = isRecord(raw.slices) ? raw.slices : undefined;
    /** Prefer the highest supplied raster ratio; never generate SVG or layer renders without a source. */
    const candidates = slices ? [slices.max, slices.base].filter(isRecord).sort((a, b) => (numeric(b.ratio) ?? 0) - (numeric(a.ratio) ?? 0)) : [];
    const slice = candidates.find(candidate => imageUrl(candidate.id));
    const sliceUrl = slice ? imageUrl(slice.id) : undefined;
    const snapshotUrl = imageUrl(raw.snapshot);
    if (slices && !sliceUrl) warn("SLICE_SOURCE_UNAVAILABLE", id, "No resolvable raster slice; SVG-only or missing images remain in the raw source.");
    /** Renaming follows the project's explicit asset overrides; null means the original name. */
    const renamed = isRecord(renameMap) && typeof renameMap[id] === "string" ? renameMap[id] : undefined;
    const name = renamed ?? (typeof raw.name === "string" ? raw.name : id);
    /** Capped export scales cannot safely define logical density without the full conversion contract. */
    const capped = slices?.limitBaseScale || slices?.limitMaxScale;
    if (capped && slice) warn("SLICE_DENSITY_UNKNOWN", id, "Capped slice scale is retained as original pixels to avoid an incorrect logical size.");
    const nextX = root || raw.isFrame ? x : frameX;
    const nextY = root || raw.isFrame ? y : frameY;
    return {
      id, name, type: root || raw.isFrame ? "frame" : raw.textbox || linkedText ? "text" : raw.type === "group" || raw.type === "component" || raw.type === "instance" ? "group" : snapshotUrl ? "image" : "shape",
      frame: { x, y, width, height }, isVisible: true, fills,
      radius: raw.borderRadius, opacity: numeric(blend.opacity),
      borderColor: border?.color, strokeWidth: numeric(stroke?.w),
      shadow: shadows.map(effect => ({ offsetX: effect.offsetX, offsetY: effect.offsetY, blur: effect.blur, spread: effect.spread, color: color(effect.color) })),
      blur: numeric(effects.filter(isRecord).find(effect => effect.visible !== false && effect.type === "filterBlur")?.blur),
      text: typeof textbox.text === "string" ? textbox.text : undefined,
      fontSize: numeric(segment.fontSize), fontFamily: fontName.family ?? fontName.postscriptName,
      fontWeight: segment.fontWeight ?? namedFontWeight(fontName.style), lineHeight: textLineHeight(segment.lineHeight ?? textbox.lineHeight), textAlign: textbox.align,
      textColor: paints(segment.fills, warnings, id)[0]?.color,
      exportable: Boolean(sliceUrl), image: sliceUrl || snapshotUrl ? { imageUrl: sliceUrl ?? snapshotUrl, sourceScale: capped ? undefined : numeric(slice?.ratio) } : undefined,
      children: Array.isArray(raw.children) ? raw.children.filter(isRecord).map((child, childIndex) => visit(child, nextX, nextY, false, `${index}-${childIndex}`)).filter(Boolean) : []
    };
  }
  const root = visit(value.pages[0], 0, 0, true);
  if (!root) throw upstreamError("MOONVY_HIDDEN_PAGE", "Genome root page is hidden.");
  if (value.pages.length > 1) warnings.push({ code: "GENOME_FIRST_PAGE", severity: "notice", message: "Used pages[0], matching Moonvy's design viewer; additional pages remain in raw Genome." });
  return { root };
}

/** Adapts enabled source paints to the shared normalizer without changing the source object. */
function paints(value: unknown, warnings: PipelineWarning[], id: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const enabled = value.filter(isRecord).filter(paint => paint.visible !== false);
  if (enabled.length > 1) warnings.push({ code: "GENOME_MULTIPLE_PAINTS", severity: "degraded", message: `Layer ${id}: multiple paints require review; the tree retains the first paint.` });
  return enabled.map(paint => {
    const gradient = isRecord(paint.gradient) ? paint.gradient : undefined;
    if (gradient && (gradient.type === "diamond" || gradient.type === "radial" || gradient.type === "angular")) warnings.push({ code: "GENOME_GRADIENT_REFERENCE", severity: "degraded", message: `Layer ${id}: gradient shape/origin requires preview verification.` });
    if (paint.image || paint.varBind) warnings.push({ code: "GENOME_PAINT_REFERENCE", severity: "degraded", message: `Layer ${id}: image fill or variable paint requires source verification.` });
    return { isEnabled: true, color: color(paint.color, numeric(paint.opacity)), gradient: gradient ? { ...gradient,
      colorStops: Array.isArray(gradient.stops) ? gradient.stops.filter(isRecord).map(stop => ({ position: stop.position, color: color(stop.color, numeric(paint.opacity)) })) : [] } : undefined };
  });
}

/** Genome RGB channels use 0..255 and alpha, unlike normalized unit-RGB design formats. */
function color(value: unknown, opacity = 1): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  const r = numeric(value.r), g = numeric(value.g), b = numeric(value.b);
  return r !== undefined && g !== undefined && b !== undefined ? `rgba(${r},${g},${b},${(numeric(value.alpha) ?? numeric(value.a) ?? 1) * opacity})` : undefined;
}

/** Rejects non-finite numbers so invalid source geometry cannot introduce NaN JSON output. */
function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Converts explicit font style names to CSS weights; unknown names remain unspecified rather than guessed. */
function namedFontWeight(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  /** Source names are normalized only for spacing and punctuation, preserving named weight semantics. */
  const weights: Record<string, number> = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
  return weights[value.toLowerCase().replace(/[\s_-]/g, "").replace(/italic$/, "")];
}

/** Keeps explicit line-height units; automatic and unknown units stay absent so text can size intrinsically. */
function textLineHeight(value: unknown): number | string | undefined {
  if (typeof value === "string" || numeric(value) !== undefined) return value as number | string;
  if (!isRecord(value)) return undefined;
  /** Genome supplies a measured value and unit; px maps to the shared numeric pixel convention. */
  const amount = numeric(value.value);
  if (amount === undefined) return undefined;
  if (value.unit === "px") return amount;
  if (value.unit === "%" || value.unit === "percent") return `${amount}%`;
  if (value.unit === "em") return `${amount}em`;
  return undefined;
}
