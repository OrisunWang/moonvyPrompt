import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAssets } from "../src/assets.js";
import { parseCliOptions } from "../src/config.js";
import { fixtureBundle, normalizeToUiTree } from "../src/normalize.js";
import { generatePrompt } from "../src/prompt.js";
import type { PipelineWarning, SourceBundle } from "../src/types.js";

/** Per-test directories are tracked by setup and removed after assertions to keep fixtures isolated. */
const dirs: string[] = [];
/** Creates a disposable output directory for downloader and client integration checks. */
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "moonvy-assets-"));
  dirs.push(path);
  return path;
}
/** Real encoded pixels exercise decoder, resizer and legacy archive cleanup instead of mocking the implementation. */
async function png(): Promise<Buffer> {
  return sharp({ create: { width: 96, height: 88, channels: 4, background: "#35bc7a" } }).png().toBuffer();
}
/** Minimal source adapter fixture mirrors the observed LikeNew image.size contract. */
function layer(id: string, source = "https://cdn.example/icon", extra = {}) {
  return { id, name: "unlock50", type: "group", width: 50, height: 50, exportable: true,
    image: { imageUrl: source, size: { width: 24, height: 22 } }, ...extra };
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("automatic slice downloads", () => {
  it("defaults on and supports disabling and explicitly re-enabling", () => {
    expect(parseCliOptions([]).options.downloadAssets).toBe(true);
    expect(parseCliOptions(["--no-download-assets"]).options.downloadAssets).toBe(false);
    expect(parseCliOptions(["--no-download-assets", "--download-assets"]).options.downloadAssets).toBe(true);
  });

  it("writes extracted PNGs without ZIPs, deduplicates content, and preserves node mappings", async () => {
    const out = await directory();
    const bytes = await png();
    const fetchBuffer = vi.fn(async () => bytes);
    const files: SourceBundle["files"] = [];
    const warnings: PipelineWarning[] = [];
    const source = { info: [layer("one"), layer("two", undefined, { name: "anotherName" }), layer("three", "https://cdn.example/alias"),
      layer("hidden", undefined, { isVisible: false }), layer("plain", undefined, { exportable: false })] };
    const assets = await downloadAssets(source, out, files, warnings, fetchBuffer);
    expect(fetchBuffer).toHaveBeenCalledTimes(2);
    expect(assets).toHaveLength(3);
    expect(new Set(assets.map((asset) => asset.localPath)).size).toBe(1);
    expect(files.filter((file) => file.type === "slice-png")).toHaveLength(3);
    expect(files.filter((file) => file.type === "slice-archive")).toHaveLength(0);
    expect(assets.map((asset) => asset.assetName)).toEqual(["unlock50", "unlock50", "unlock50"]);
    expect(assets[1].name).toBe("anotherName");
    expect(assets[0].localPath).toBe("assets/unlock50/unlock50.png");
    expect(assets[0].archivePath).toBeUndefined();
    await expect(stat(join(out, "assets/unlock50.zip"))).rejects.toMatchObject({ code: "ENOENT" });
    for (const variant of assets[0].variants) {
      const meta = await sharp(await readFile(join(out, variant.localPath))).metadata();
      expect([meta.width, meta.height]).toEqual([24 * variant.scale!, 22 * variant.scale!]);
    }
    const pngPath = join(out, assets[0].localPath!);
    const before = await stat(pngPath);
    await downloadAssets(source, out, [], [], fetchBuffer);
    expect((await stat(pngPath)).mtimeMs).toBe(before.mtimeMs);
    const document = normalizeToUiTree({ ...fixtureBundle("test", source), assets });
    expect(document.assets).toEqual(assets);
    expect(JSON.stringify(document.tree)).toContain(assets[0].localPath);
    expect(JSON.stringify(document)).not.toContain("archivePath");
    expect(generatePrompt(document)).toContain("相同的素材不要重复添加。");
    expect(warnings).toEqual([]);
  });

  it("keeps UI names safe and disambiguates case-insensitive names without overwriting files", async () => {
    const out = await directory();
    const names = ["icon", "ICON", "icon_2", "../图标/返回@2x.png", "...", "é", "e\u0301", "图".repeat(200)];
    const assets = await downloadAssets({ info: names.map((name, index) => layer(String(index), `https://cdn.example/${index}`, { name })) },
      out, [], [], async (url) => sharp({ create: { width: 96, height: 88, channels: 4,
        background: { r: Number(url.split("/").at(-1)) * 20, g: 100, b: 0, alpha: 1 } } }).png().toBuffer());
    expect(assets.map((asset) => asset.assetName).slice(0, 7)).toEqual(["icon", "ICON_2", "icon_2_2", "_图标_返回", "asset", "é", "é_2"]);
    expect(new Set(assets.map((asset) => asset.localPath!.toLowerCase())).size).toBe(names.length);
    for (const asset of assets) {
      expect(Buffer.byteLength(asset.assetName)).toBeLessThanOrEqual(160);
      for (const variant of asset.variants) {
        const meta = await sharp(await readFile(join(out, variant.localPath))).metadata();
        expect([meta.width, meta.height]).toEqual([variant.width, variant.height]);
      }
    }
  });

  it("deletes a legacy ZIP only after verifying its PNGs and omits it from the output catalog", async () => {
    const out = await directory();
    const bytes = await png();
    const source = { info: [layer("one")] };
    const initial = await downloadAssets(source, out, [], [], async () => bytes);
    const entries = Object.fromEntries(await Promise.all(initial[0].variants.map(async (variant) =>
      [variant.localPath.slice("assets/".length), await readFile(join(out, variant.localPath))])));
    const archivePath = join(out, "assets/unlock50.zip");
    await writeFile(archivePath, zipSync(entries));
    const warnings: PipelineWarning[] = [];
    const files: SourceBundle["files"] = [];
    const assets = await downloadAssets(source, out, files, warnings, async () => bytes);
    await expect(stat(archivePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(assets[0].archivePath).toBeUndefined();
    expect(files.every((file) => file.type !== "slice-archive")).toBe(true);
    expect(warnings).toEqual([]);
    for (const variant of assets[0].variants) {
      expect(await readFile(join(out, variant.localPath))).toEqual(Buffer.from(entries[variant.localPath.slice("assets/".length)]));
    }
  });

  it.each(["different-content", "extra-entry", "corrupt", "write-failure"])("retains legacy ZIP on %s", async (failure) => {
    const out = await directory();
    const bytes = await png();
    const source = { info: [layer("one")] };
    const initial = await downloadAssets(source, out, [], [], async () => bytes);
    const entries = Object.fromEntries(await Promise.all(initial[0].variants.map(async (variant) =>
      [variant.localPath.slice("assets/".length), await readFile(join(out, variant.localPath))])));
    if (failure === "different-content") entries["unlock50/unlock50.png"] = Buffer.from("different");
    if (failure === "extra-entry") entries["notes.txt"] = Buffer.from("preserve me");
    const archive = failure === "corrupt" ? Buffer.from("invalid zip") : Buffer.from(zipSync(entries));
    const archivePath = join(out, "assets/unlock50.zip");
    await writeFile(archivePath, archive);
    if (failure === "write-failure") {
      const target = join(out, initial[0].variants[0].localPath);
      await rm(target);
      await mkdir(target); // A directory at the PNG path forces a real write failure before any cleanup.
    }
    const warnings: PipelineWarning[] = [];
    const files: SourceBundle["files"] = [];
    const assets = await downloadAssets(source, out, files, warnings, async () => bytes);
    expect(await readFile(archivePath)).toEqual(archive);
    expect(warnings.map((warning) => warning.code)).toContain(failure === "write-failure" ? "SLICE_EXPORT_FAILED" : "ASSET_ARCHIVE_CLEANUP_FAILED");
    if (failure !== "write-failure") {
      expect(assets[0].archivePath).toBe("assets/unlock50.zip");
      expect(files.some((file) => file.type === "slice-archive")).toBe(true);
    }
  });

  it("continues through missing sources, invalid images and partial network failures", async () => {
    const out = await directory();
    const bytes = await png();
    const fetchBuffer = vi.fn(async (url: string) => url.endsWith("bad") ? Buffer.from("<html>login</html>") : url.endsWith("offline") ? undefined : bytes);
    const warnings: PipelineWarning[] = [];
    const assets = await downloadAssets({ info: [layer("missing", undefined, { image: {} }),
      layer("bad", "https://cdn.example/bad"), layer("offline", "https://cdn.example/offline"), layer("good")] }, out, [], warnings, fetchBuffer);
    expect(assets.map((asset) => asset.nodeId)).toEqual(["good"]);
    expect(warnings.map((warning) => warning.code)).toContain("SLICE_EXPORT_FAILED");
    expect(warnings.map((warning) => warning.code)).toContain("SLICE_SOURCE_UNAVAILABLE");
  });

  it("does not upscale unavailable densities and retains unknown-density originals", async () => {
    const bytes = await png();
    const warnings: PipelineWarning[] = [];
    const assets = await downloadAssets({ info: [layer("small", undefined, { image: { imageUrl: "https://cdn.example/large", size: { width: 96, height: 88 } } }),
      layer("unknown", undefined, { image: { imageUrl: "https://cdn.example/unknown" } })] }, await directory(), [], warnings, async () => bytes);
    expect(assets[0].variants.map((variant) => variant.scale)).toEqual([1]);
    expect(assets[1].variants[0].scale).toBeUndefined();
    expect(warnings.filter((warning) => warning.code === "SLICE_RESOLUTION_UNAVAILABLE")).toHaveLength(2);
  });

});
