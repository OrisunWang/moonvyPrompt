/** Severity levels used to decide whether a pipeline issue blocks output. */
export type WarningSeverity = "fatal" | "degraded" | "notice";

/** User-facing warning or error detail that never includes credentials. */
export interface PipelineWarning {
  /** Stable warning code written by converter or fetch pipeline. */
  code: string;
  /** Operational severity for the issue. */
  severity: WarningSeverity;
  /** Human-readable explanation of what happened. */
  message: string;
  /** Concrete recovery suggestion for the user or future maintainer. */
  hint?: string;
}

/** Parsed identifiers from the official Moonvy project/folder/item route. */
export interface MoonvyUrlParams {
  /** Original input string supplied by the caller. */
  source: string;
  /** Optional source team identifier retained by compatible imported fixtures. */
  teamId?: string;
  /** URL parser supplies the parent folder id for design provenance. */
  folderId?: string;
  /** URL parser supplies the project id used for authenticated node queries. */
  projectId: string;
  /** URL parser supplies the concrete design item id used by the pipeline. */
  itemId: string;
}

/** Credentials loaded from environment variables or `.env.local`. */
export interface MoonvyCredentials {
  /** Full browser Cookie header used for authenticated Moonvy requests. */
  cookie?: string;
  /** Optional Authorization header copied from browser network requests. */
  authorization?: string;
  /** Filesystem or process source of the credential values. */
  source: "env" | ".env.local" | "missing";
}

/** Canvas dimensions normalized to @1x pixels. */
export interface CanvasSize {
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
}

/** Absolute or parent-relative rectangle. */
export interface Bounds {
  /** Left coordinate in pixels. */
  x: number;
  /** Top coordinate in pixels. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/** Border information when the source exposes stroke data. */
export interface StrokeStyle {
  /** Stroke color as a CSS-compatible string. */
  color?: string;
  /** Stroke width in pixels. */
  width?: number;
  /** Stroke style such as solid or dashed. */
  style?: string;
}

/** Shadow information normalized into CSS-like primitives. */
export interface ShadowStyle {
  /** Horizontal offset in pixels. */
  x: number;
  /** Vertical offset in pixels. */
  y: number;
  /** Blur radius in pixels. */
  blur: number;
  /** Spread radius in pixels. */
  spread: number;
  /** Shadow color as a CSS-compatible string. */
  color: string;
}

/** Visual style facts available for non-text and text nodes. */
export interface NodeStyle {
  /** Fill color or CSS-compatible gradient value from the source. */
  fill?: string;
  /** Optional stroke style from the source. */
  stroke?: StrokeStyle;
  /** Opacity from 0 to 1. */
  opacity?: number;
  /** Corner radius as one value or four corner values. */
  radius?: number | [number, number, number, number];
  /** Drop shadows or inner shadows from the source. */
  shadow?: ShadowStyle[];
  /** Blur radius when available. */
  blur?: number;
}

/** How implementation consumers should interpret a geometry-derived spacing value. */
export type SpacingUsage = "layout-spacing" | "reference-only";

/** Geometry relationship between two nearest sibling nodes. */
export interface SpacingRelation {
  /** Axis stored by the normalizer to tell consumers how the two sibling edges were compared. */
  axis: "horizontal" | "vertical";
  /** Stable id selected by the normalizer for the sibling before the measured gap. */
  fromNodeId: string;
  /** Stable id selected by the normalizer for the nearest sibling after the measured gap. */
  toNodeId: string;
  /** Non-negative @1x edge distance calculated from the source annotation bounds. */
  sourceEdgeGap: number;
  /** Leading-edge delta retained as a runtime-independent reference position for implementation verification. */
  referenceAnchorDelta: number;
  /** Anchor definition used by `referenceAnchorDelta`; currently the source top or left edge. */
  anchor: "leading-edge";
  /** Normalizer recommendation that prevents text annotation bounds from becoming stack spacing. */
  usage: SpacingUsage;
}

/** Framework-independent sizing policy attached by the normalizer to every text node. */
export interface TextLayoutPolicy {
  /** Tells implementation code to let the target text renderer determine the total region size. */
  sizing: "intrinsic";
  /** Marks the source text bounds as alignment and verification facts rather than fixed constraints. */
  boundsRole: "reference";
  /** Tells dynamic or multiline text to move following content instead of clipping into the source height. */
  overflow: "reflow";
}

/** Typography and content facts for text nodes. */
export interface TextStyle {
  /** Text content exactly as exposed by the design source. */
  content: string;
  /** Font family name when the source provides it. */
  fontFamily?: string;
  /** Font size in pixels. */
  fontSize?: number;
  /** Font weight as numeric or named CSS weight. */
  fontWeight?: number | string;
  /** Source-declared baseline line height; this is not a target framework's measured text-box height. */
  lineHeight?: number | string;
  /** Text color as a CSS-compatible string. */
  color?: string;
  /** Horizontal alignment value from the source. */
  align?: string;
  /** Intrinsic sizing policy populated by the normalizer for implementation consumers. */
  layout: TextLayoutPolicy;
}

/** Reference to an asset downloaded or discovered during fetch. */
export interface AssetReference {
  /** Original URL found in the Moonvy response. */
  source?: string;
  /** Local relative path when an asset has been downloaded. */
  localPath?: string;
  /** Legacy ZIP path retained only when verified cleanup could not complete; normal exports omit it. */
  archivePath?: string;
  /** Asset role inferred from type or dimensions. */
  role?: "preview" | "image" | "icon" | "background" | "unknown";
}

/** Downloader-produced catalog entry associates shared physical files with each source layer. */
export interface DownloadedAsset extends AssetReference {
  /** Exporter allocates the canonical UI-derived name; duplicate layers reuse it when importing into app assets. */
  assetName: string;
  /** Adapter sets the owning layer id; normalizer uses it to attach asset references. */
  nodeId: string;
  /** Adapter preserves the layer name for identifying the material in handoff documents. */
  name: string;
  /** Adapter supplies logical slice dimensions; downloader uses them to render scale variants. */
  size?: { width: number; height: number };
  /** Downloader lists successful PNG variants; consumers select the required density. */
  variants: Array<{
    /** Downloader sets the relative PNG path reused by equal content. */
    localPath: string;
    /** Downloader computes a content hash for checking existing app assets before importing. */
    sha256: string;
    /** Downloader records density only when logical source dimensions are known. */
    scale?: number;
    /** PNG encoder reports output pixel width for verification. */
    width: number;
    /** PNG encoder reports output pixel height for verification. */
    height: number;
  }>;
}

/** Layout hints inferred from sibling geometry. */
export interface LayoutHints {
  /** Sibling flow direction inferred from positions. */
  direction: "row" | "column" | "overlap" | "absolute";
  /** Median gap between sibling boxes when inferable. */
  gap?: number;
  /** Recommendation populated by the normalizer for whether `gap` is safe as flow-layout spacing. */
  gapUsage?: SpacingUsage;
  /** Parent-to-children padding inferred from bounds. */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Alignment inferred along the cross axis. */
  alignment?: "start" | "center" | "end" | "mixed";
  /** Nearest-neighbor geometry populated by the normalizer, including text-safe usage metadata. */
  childSpacing?: SpacingRelation[];
  /** Whether positions should be treated as exact or flow-derived. */
  positioning: "absolute" | "flow-inferred";
}

/** Normalized UI node consumed by AI implementation prompts. */
export interface UiNode {
  /** Stable node id from the source or generated fallback id. */
  id: string;
  /** Human-readable layer name. */
  name: string;
  /** Semantic node type inferred from source type and style. */
  type: "frame" | "group" | "text" | "image" | "shape" | "icon" | "unknown";
  /** Absolute bounds in @1x page coordinates. */
  bounds: Bounds;
  /** Bounds relative to the parent node. */
  relative: Bounds;
  /** Visual style facts when available. */
  style?: NodeStyle;
  /** Text content and typography when this is a text node. */
  text?: TextStyle;
  /** Asset reference when the node points at an image-like source. */
  asset?: AssetReference;
  /** Layout hint inferred for this node's children. */
  layoutHints?: LayoutHints;
  /** Child nodes in paint/source order. */
  children: UiNode[];
}

/** Design tokens extracted from normalized nodes. */
export interface DesignTokens {
  /** Unique solid fill, text, stroke, and gradient-stop colors collected by the token extractor for implementation. */
  colors: string[];
  /** Unique CSS-compatible gradient fills collected by the token extractor for implementation. */
  gradients: string[];
  /** Unique font size/weight/family combinations. */
  typography: Array<{ fontFamily?: string; fontSize?: number; fontWeight?: number | string; color?: string }>;
  /** Distinct non-text gaps considered safe for direct flow-layout spacing. */
  spacing: number[];
  /** Distinct source edge gaps involving text, retained only for design comparison and diagnostics. */
  referenceSpacing: number[];
  /** Distinct corner radii found on nodes. */
  radius: number[];
  /** Distinct shadow strings derived from normalized shadow objects. */
  shadows: string[];
}

/** Metadata for a normalized UI tree document. */
export interface UiTreeMeta {
  /** Original URL or file path used as input. */
  sourceUrl: string;
  /** Moonvy item identifier or local fixture name. */
  pageId: string;
  /** Moonvy project id when known. */
  projectId?: string;
  /** Moonvy team id when known. */
  teamId?: string;
  /** Best source used by the transformer. */
  sourceType: "genome" | "dds-schema" | "design-document" | "html-css" | "preview-image" | "fixture" | "unknown";
  /** Page canvas size in @1x pixels. */
  canvas: CanvasSize;
  /** Coordinate scale applied during normalization. */
  scale: number;
  /** Generation timestamp in ISO 8601 format. */
  generatedAt: string;
  /** Confidence that the tree reflects true design structure. */
  confidence: "high" | "medium" | "low";
}

/** Full JSON document emitted as `ui-tree.json`. */
export interface UiTreeDocument {
  /** Source and normalization metadata. */
  meta: UiTreeMeta;
  /** Tokens extracted from the normalized tree. */
  tokens: DesignTokens;
  /** Root node of the normalized UI tree. */
  tree: UiNode;
  /** Downloader supplies the slice catalog; normalizer retains it for implementation handoff. */
  assets?: DownloadedAsset[];
  /** Non-fatal warnings collected during fetch and conversion. */
  warnings: PipelineWarning[];
}

/** Raw source bundle collected from Moonvy or local fixtures. */
export interface SourceBundle {
  /** Original input or local file path. */
  sourceUrl: string;
  /** Parsed Moonvy ids when input was a Moonvy URL. */
  params?: MoonvyUrlParams;
  /** Best structured source object, if one was fetched or loaded. */
  structured?: unknown;
  /** Type of the structured source. */
  sourceType: UiTreeMeta["sourceType"];
  /** Optional preview image metadata. */
  preview?: AssetReference & { width?: number; height?: number };
  /** Downloader stores all successfully exported layer assets for the tree and manifest. */
  assets?: DownloadedAsset[];
  /** Raw artifact file paths written during fetch. */
  files: Array<{ path: string; type: string; bytes: number }>;
  /** Warnings collected while fetching sources. */
  warnings: PipelineWarning[];
}

/** JSON envelope used by reporting commands. */
export interface CliEnvelope<T> {
  /** Whether the command completed successfully. */
  ok: boolean;
  /** CLI command name. */
  command: string;
  /** Successful command data. */
  data?: T;
  /** Non-fatal warnings emitted by the command. */
  warnings?: PipelineWarning[];
  /** Fatal error detail when `ok` is false. */
  error?: PipelineWarning;
  /** Runtime metadata for the command. */
  meta: { version: string; durationMs: number };
}
