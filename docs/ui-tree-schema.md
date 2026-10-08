# UI Tree Schema

`ui-tree.json` is the stable contract consumed by AI coding agents.

## Root

```ts
interface UiTreeDocument {
  meta: UiTreeMeta;
  tokens: DesignTokens;
  tree: UiNode;
  warnings: PipelineWarning[];
}
```

## Meta

- `sourceUrl`: original Moonvy URL or local fixture path.
- `pageId`: Moonvy itemId / fixture name.
- `projectId`: parsed `pid` or `project_id` when available.
- `teamId`: parsed `tid` when available.
- `sourceType`: `dds-schema`, `design-document`, `html-css`, `preview-image`, `fixture`, or `unknown`.
- `canvas`: page width and height in @1x pixels.
- `scale`: coordinate scale, currently `1`.
- `generatedAt`: ISO timestamp.
- `confidence`: `high`, `medium`, or `low`.

## Node

```ts
interface UiNode {
  id: string;
  name: string;
  type: "frame" | "group" | "text" | "image" | "shape" | "icon" | "unknown";
  bounds: Bounds;
  relative: Bounds;
  style?: NodeStyle;
  text?: TextStyle;
  asset?: AssetReference;
  layoutHints?: LayoutHints;
  children: UiNode[];
}
```

## Geometry

All values are normalized to @1x pixels.

- `bounds`: absolute page coordinates.
- `relative`: coordinates relative to the parent node.
- Text bounds are source annotation boxes used for alignment and visual verification; their width and height are not implementation constraints.
- In screenshot fallback mode, the root and image node may share the same bounds.

## Text Layout

Every normalized text node has a framework-independent `text.layout` policy:

- `sizing: intrinsic`: let the target renderer determine the text region's total width and height.
- `boundsRole: reference`: use source bounds to verify anchors and the reference design, never to emit a fixed text height.
- `overflow: reflow`: multiline or dynamic content expands naturally and moves following content instead of clipping.
- `lineHeight`: source-declared baseline spacing. It is not the target framework's measured text-box height and must not be substituted for a fixed total height.

## Style

Style values are kept as direct design facts.

- `fill`: CSS color or normalized `linear-gradient(...)`, `radial-gradient(...)`, or `conic-gradient(...)` string.
- `stroke`: color, width, and style.
- `opacity`: number from `0` to `1`.
- `radius`: one number or four values ordered top-left, top-right, bottom-right, bottom-left.
- `shadow`: CSS-like shadow objects.
- `blur`: blur radius when available.

Missing style fields mean the source did not provide that fact.

## Layout Hints

`layoutHints` helps AI agents choose flex/grid-like implementation primitives without losing exact design coordinates.

- `direction`: `row`, `column`, `overlap`, or `absolute`.
- `gap`: median source-bounds gap when inferable.
- `gapUsage`: `layout-spacing` for geometry that is safe to map to flow spacing, or `reference-only` when text participates.
- `padding`: distance between parent edges and child bounds.
- `alignment`: `start`, `center`, `end`, or `mixed`.
- `childSpacing`: nearest-neighbor geometry retained even when background or decoration layers make the parent an overlapping layout.
  - `sourceEdgeGap`: exact edge gap calculated from source annotation bounds.
  - `referenceAnchorDelta`: top-to-top or left-to-left distance that remains valid when runtime text height differs.
  - `anchor`: currently `leading-edge`.
  - `usage`: `layout-spacing` only when neither endpoint contains text; otherwise `reference-only`.
- `positioning`: `absolute` or `flow-inferred`.

## Design Tokens

- `colors`: solid fills, text colors, stroke colors, and individual gradient-stop colors.
- `gradients`: complete normalized CSS-compatible gradient strings.
- `spacing`: distinct non-text gaps that consumers may use as direct stack/flex spacing.
- `referenceSpacing`: distinct source edge gaps involving text, retained only for comparison and diagnostics.
- `radius`: distinct scalar and per-corner radius values.

## Downloaded slices

Network results may include an `assets` array. Each entry associates `nodeId` and
`name` and canonical `assetName` with `source`, logical `size`, a primary `localPath`, an optional retained legacy `archivePath`, and
`variants` (`localPath`, `sha256`, optional density `scale`, pixel `width`/`height`).
Paths are relative to the output directory. The same catalog appears in
`assets/index.json` and the run manifest. Matching tree nodes expose the primary
PNG via `asset` (plus a legacy ZIP only when cleanup fails); the full variants remain in the catalog. Shared hashes
and paths intentionally represent reused material. `name` preserves the source UI
name; `assetName` is the safe, collision-resolved UI name used in PNG paths
and recommended for the iOS asset catalog. Identical content with a different
source name reuses the first exported `assetName`. Disabled downloads omit the
catalog; no discovered/successful slices produce an empty catalog. Successful
exports keep only extracted PNGs: verified redundant ZIPs are deleted and omitted
from the catalog and manifest. Cleanup failures retain the ZIP and emit a warning.

## Moonvy 来源

meta.sourceType 增加 genome；pageId 是 itemId。Genome raw pages[0] 经适配到共同树格式，复杂或尚未完全支持的源事实以 warnings 提示，confidence=medium；完整样式在 raw/genome.json。离线 Genome 使用 sourceType=fixture。assets 节点使用源 slices 倍率和编码像素计算逻辑尺寸。
