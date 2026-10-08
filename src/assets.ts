import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { writeBufferIfChanged, writeTextIfChanged } from "./fs-utils.js";
import type { DownloadedAsset, PipelineWarning, SourceBundle } from "./types.js";

/** Source-backed slice candidate collected by the adapter; never inferred from ordinary image URLs. */
interface Slice {
  /** Adapter copies the owning layer id so normalization can attach the downloaded reference. */
  nodeId: string;
  /** Adapter copies the UI layer name; exporter sanitizes it before using it for filenames. */
  name: string;
  /** Adapter reads the PNG URL from the exportable layer; downloader fetches it once per run. */
  source: string;
  /** Adapter copies logical dimensions from image.size for density-aware PNG rendering. */
  size?: { width: number; height: number };
  /** Genome adapter supplies pixels-per-logical-unit; downloader derives size from decoded pixels. */
  sourceScale?: number;
}

/** Finds exportable Sketch-style layers across flat info[] and nested DDS node collections. */
function discoverSlices(source: unknown, warnings: PipelineWarning[]): Slice[] {
  /** Traversal accumulates candidates, while duplicate node/source entries are removed before downloading. */
  const slices: Slice[] = [];
  /** Visits only structured values; source JSON cannot introduce cycles. */
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    // Hidden layers and their descendants must not create implementation assets.
    if (record.isVisible === false) return;
    if (record.exportable === true || record.type === "slice") {
      const image = record.image as Record<string, unknown> | undefined;
      const url = image?.imageUrl;
      const id = record.id ?? record.objectID ?? record.guid ?? record.uuid;
      if (typeof url === "string" && /^https:\/\//i.test(url) && typeof id === "string") {
        const size = image?.size as { width?: unknown; height?: unknown } | undefined;
        slices.push({ nodeId: id, name: typeof record.name === "string" ? record.name : id, source: url,
          sourceScale: typeof image?.sourceScale === "number" && Number.isFinite(image.sourceScale) && image.sourceScale > 0 ? image.sourceScale : undefined,
          size: typeof size?.width === "number" && typeof size.height === "number" &&
            Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
            ? { width: size.width, height: size.height } : undefined });
      } else {
        warnings.push({ code: "SLICE_SOURCE_UNAVAILABLE", severity: "degraded", message: "An exportable layer has no supported HTTPS PNG source or stable layer id." });
      }
    }
    Object.values(record).forEach(visit);
  }
  visit(source);
  return [...new Map(slices.map((slice) => [`${slice.nodeId}\0${slice.source}`, slice])).values()];
}

/** Downloads UI-named PNG variants directly; removes redundant legacy ZIPs only after verifying extracted files. */
export async function downloadAssets(
  source: unknown, outputDir: string, files: SourceBundle["files"], warnings: PipelineWarning[],
  fetchBuffer: (url: string) => Promise<Buffer | undefined>
): Promise<DownloadedAsset[]> {
  /** Per-run URL cache prevents repeated network requests, including repeated failures. */
  const sources = new Map<string, Buffer | undefined>();
  /** Catalog retains every owning node even when its physical files are shared. */
  const assets: DownloadedAsset[] = [];
  /** Content signatures map duplicate slices to the first exported UI name and shared physical files. */
  const exported = new Map<string, Pick<DownloadedAsset, "assetName" | "variants" | "localPath" | "archivePath">>();
  /** Allocator tracks normalized names to avoid collisions on case-insensitive macOS volumes. */
  const usedNames = new Set<string>();
  /** Paths already emitted in this run are registered only once in the manifest. */
  const registered = new Set<string>();
  /** Writes a stable binary artifact and records it once even when several layers reference it. */
  async function save(relativePath: string, buffer: Buffer, type: string): Promise<void> {
    if (registered.has(relativePath)) return;
    const written = await writeBufferIfChanged(join(outputDir, relativePath), buffer);
    files.push({ path: written.path, type, bytes: written.bytes });
    registered.add(relativePath);
  }
  for (const slice of discoverSlices(source, warnings)) {
    if (!sources.has(slice.source)) sources.set(slice.source, await fetchBuffer(slice.source));
    const buffer = sources.get(slice.source);
    if (!buffer) continue;
    try {
      const metadata = await sharp(buffer).metadata();
      if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("Invalid PNG source");
      // Use encoded pixel dimensions and the source-declared ratio, since slice bounds may include effects.
      if (!slice.size && slice.sourceScale) slice.size = { width: metadata.width / slice.sourceScale, height: metadata.height / slice.sourceScale };
      /** Renderer collects bytes and density metadata before naming, allowing content-based reuse across layer names. */
      const rendered: Array<Omit<DownloadedAsset["variants"][number], "localPath"> & { png: Buffer }> = [];
      // Without a logical size, retain original pixels and never invent an @1x density.
      if (!slice.size) warnings.push({ code: "SLICE_DENSITY_UNKNOWN", severity: "notice", message: `Slice ${slice.nodeId} has no logical size; original pixels were retained without a density label.` });
      const scales = slice.size ? [1, 2, 3] : [undefined];
      for (const scale of scales) {
        const width = scale && slice.size ? Math.max(1, Math.round(slice.size.width * scale)) : metadata.width;
        const height = scale && slice.size ? Math.max(1, Math.round(slice.size.height * scale)) : metadata.height;
        if (width > metadata.width || height > metadata.height) {
          warnings.push({ code: "SLICE_RESOLUTION_UNAVAILABLE", severity: "degraded", message: `Slice ${slice.nodeId} lacks source pixels for @${scale}x; that variant was omitted.` });
          continue;
        }
        const png = await sharp(buffer).resize(width, height, { fit: "fill" }).png().toBuffer();
        const sha256 = hash(png);
        rendered.push({ sha256, scale, width, height, png });
      }
      if (!rendered.length) continue;
      // Hashes remain internal identifiers: source names and URLs do not prevent equal slices from sharing files.
      const signature = hash(Buffer.from(JSON.stringify(rendered.map(({ png: _png, ...variant }) => variant))));
      const reused = exported.get(signature);
      if (reused) {
        assets.push({ ...slice, role: "image", ...reused });
        continue;
      }
      const assetName = allocateAssetName(slice.name, usedNames);
      const variants: DownloadedAsset["variants"] = [];
      for (const { png, ...variant } of rendered) {
        // Standard iOS density suffixes keep the catalog name clean; unknown density stays explicitly marked.
        const suffix = variant.scale === 1 ? "" : variant.scale ? `@${variant.scale}x` : "-original";
        const filename = `${assetName}${suffix}.png`;
        const localPath = `assets/${assetName}/${filename}`;
        await save(localPath, png, "slice-png");
        variants.push({ ...variant, localPath });
      }
      // PNGs are already the extracted deliverable; avoid creating an archive only to delete it again.
      const archivePath = await removeRedundantArchive(outputDir, assetName, variants, files, warnings);
      const reference = { assetName, localPath: variants[0].localPath, archivePath, variants };
      exported.set(signature, reference);
      assets.push({ ...slice, role: "image", ...reference });
    } catch {
      // Decoder and filesystem errors may contain sensitive URLs; emit only a safe layer identifier.
      warnings.push({ code: "SLICE_EXPORT_FAILED", severity: "degraded", message: `Could not export slice ${slice.nodeId}.`, hint: "Check the source PNG and output directory, then retry." });
    }
  }
  const index = await writeTextIfChanged(join(outputDir, "assets/index.json"), JSON.stringify({ assets }, null, 2));
  files.push({ path: index.path, type: "asset-index", bytes: index.bytes });
  return assets;
}

/** Deletes only a matching legacy ZIP after all expected PNGs are readable and byte-identical to its contents. */
async function removeRedundantArchive(
  outputDir: string, assetName: string, variants: DownloadedAsset["variants"],
  files: SourceBundle["files"], warnings: PipelineWarning[]
): Promise<string | undefined> {
  /** Exporter-derived safe path targets this slice only; never scan or delete unrelated archives. */
  const relativePath = `assets/${assetName}.zip`;
  /** Original archive bytes are retained for validation and reporting if cleanup cannot complete. */
  let archive: Buffer;
  try {
    archive = await readFile(join(outputDir, relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    warnings.push({ code: "ASSET_ARCHIVE_CLEANUP_FAILED", severity: "notice", message: `Could not read ${relativePath}; it was left untouched.` });
    return undefined;
  }
  try {
    const entries = unzipSync(archive);
    // Exact entry matching prevents deleting packages with extra files or paths outside the known slice folder.
    if (Object.keys(entries).length !== variants.length) throw new Error("Archive entries differ");
    for (const variant of variants) {
      const entry = entries[variant.localPath.slice("assets/".length)];
      const extracted = await readFile(join(outputDir, variant.localPath));
      if (!entry || !extracted.equals(Buffer.from(entry)) || hash(extracted) !== variant.sha256) {
        throw new Error("Extracted PNG differs");
      }
    }
    // Deletion runs last: write or validation failures leave the original ZIP available for recovery.
    await unlink(join(outputDir, relativePath));
    return undefined;
  } catch {
    warnings.push({ code: "ASSET_ARCHIVE_CLEANUP_FAILED", severity: "notice", message: `Kept ${relativePath}: its extracted files could not be verified or the ZIP could not be removed.` });
    files.push({ path: join(outputDir, relativePath), type: "slice-archive", bytes: archive.length });
    return relativePath;
  }
}

/** Preserves readable UI names while removing path syntax and allocating distinct names for different content. */
function allocateAssetName(name: string, usedNames: Set<string>): string {
  // Normalize Unicode for macOS, strip image extensions/density suffixes, and neutralize path traversal characters.
  let base = name.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .trim().replace(/\.(png|jpe?g|webp|svg|zip)$/i, "").replace(/@[1-9]\d*x$/i, "")
    .replace(/^[. ]+|[. ]+$/g, "");
  // Leave room under common 255-byte filename limits for density and conflict suffixes, including Unicode names.
  while (Buffer.byteLength(base, "utf8") > 160) base = Array.from(base).slice(0, -1).join("");
  if (!base) base = "asset";
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) candidate = `${base}_${suffix++}`;
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/** Hashes generated bytes to compare content without exposing hashes as user-facing filenames. */
function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
