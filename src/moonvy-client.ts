import { basename, join } from "node:path";
import sharp from "sharp";
import { downloadAssets } from "./assets.js";
import { configError, upstreamError } from "./errors.js";
import { ensureDir, writeBufferIfChanged, writeTextIfChanged } from "./fs-utils.js";
import { adaptGenome, isRecord } from "./moonvy-genome.js";
import { parseMoonvyUrl } from "./url.js";
import type { MoonvyCredentials, PipelineWarning, SourceBundle } from "./types.js";

/** Read-only client follows the official site's node, project-info and Genome contracts. */
export class MoonvyClient {
  /** Loader supplies the session; only the exact official API origin receives it. */
  private readonly credentials: MoonvyCredentials;
  /** Constructor supplies a finite per-request timeout used for every network stage. */
  private readonly timeoutMs: number;

  /** Keeps authentication data private and never embeds it in source URLs or artifacts. */
  constructor(credentials: MoonvyCredentials, timeoutMs = 30000) {
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
  }

  /** Reports configuration presence only; this offline check does not verify token validity. */
  authStatus() {
    return { ready: Boolean(this.credentials.authorization), source: this.credentials.source,
      hasCookie: Boolean(this.credentials.cookie), hasAuthorization: Boolean(this.credentials.authorization), verified: false };
  }

  /** Retrieves the concrete item, adapts Genome and downloads source-backed slices by default. */
  async fetchSources(url: string, outputDir: string, autoDownloadAssets = true): Promise<SourceBundle> {
    /** Validate inputs before any network or filesystem mutation. */
    const params = parseMoonvyUrl(url);
    if (!this.credentials.authorization) throw configError("MISSING_MOONVY_AUTHORIZATION", "MOONVY_AUTHORIZATION is required for Moonvy network commands.", "Save the full Authorization header from an api.moonvy.com request in .env.local.");
    /** Mandatory metadata failures must fail the command instead of producing a misleading empty tree. */
    const envelope = await this.requestJson("https://api.moonvy.com/anynode/get", { projectId: params.projectId, id: params.itemId, lv: "full" });
    const item = unwrapMoonvyEnvelope(envelope);
    if (!isRecord(item) || typeof item.id !== "string" || item.id !== params.itemId) throw upstreamError("MOONVY_ITEM_UNAVAILABLE", "Moonvy did not return the requested design item.");
    /** Every stage appends only files actually written during this invocation. */
    const files: SourceBundle["files"] = [];
    /** Optional assets and incomplete styles append warnings without disguising authentication failures. */
    const warnings: PipelineWarning[] = [];
    await ensureDir(join(outputDir, "raw"));
    await ensureDir(join(outputDir, "assets"));
    /** Preserve response bodies for local inspection without storing request headers. */
    const saveJson = async (name: string, value: unknown) => {
      const result = await writeTextIfChanged(join(outputDir, "raw", `${name}.json`), JSON.stringify(value, null, 2));
      files.push({ path: result.path, type: name, bytes: result.bytes });
    };
    await saveJson("item", envelope);
    /** Project disk is needed only for old Genome image references without explicit URLs. */
    let disk: string | undefined;
    try {
      const projectEnvelope = await this.requestJson(`https://api.moonvy.com/project/project-info?projectId=${encodeURIComponent(params.projectId)}`);
      const project = unwrapMoonvyEnvelope(projectEnvelope);
      if (isRecord(project) && typeof project.disk === "string") disk = project.disk;
      await saveJson("project-info", projectEnvelope);
    } catch {
      warnings.push({ code: "PROJECT_INFO_UNAVAILABLE", severity: "degraded", message: "Project disk metadata is unavailable; legacy image ids may not resolve." });
    }
    /** Official metadata points to the complete design JSON in files.genome.url. */
    const genomeUrl = isRecord(item.files) && isRecord(item.files.genome) ? httpsUrl(item.files.genome.url) : undefined;
    let structured: unknown;
    if (genomeUrl) {
      try {
        const genome = await this.requestJson(genomeUrl);
        await saveJson("genome", genome);
        structured = adaptGenome(genome, warnings, disk, isRecord(item.config) ? item.config.assetRenameMap : undefined);
      } catch {
        warnings.push({ code: "GENOME_FETCH_FAILED", severity: "degraded", message: "Could not read or adapt the Genome design document." });
      }
    }
    /** Moonvy preview.normal is a source URL; filenames are never derived from untrusted paths. */
    const previewUrl = isRecord(item.preview) ? httpsUrl(item.preview.normal) : undefined;
    let preview: SourceBundle["preview"];
    if (previewUrl) {
      const buffer = await this.safeBuffer(previewUrl, warnings, "preview");
      if (buffer) {
        try {
          const metadata = await sharp(buffer).metadata();
          const ext = metadata.format === "jpeg" ? ".jpg" : metadata.format === "webp" ? ".webp" : ".png";
          const result = await writeBufferIfChanged(join(outputDir, "assets", `preview${ext}`), buffer);
          files.push({ path: result.path, type: "preview", bytes: result.bytes });
          preview = { source: previewUrl, localPath: `assets/${basename(result.path)}`, role: "preview", width: isRecord(item.meta) && isRecord(item.meta.designInfo) && typeof item.meta.designInfo.w === "number" ? item.meta.designInfo.w : metadata.width, height: isRecord(item.meta) && isRecord(item.meta.designInfo) && typeof item.meta.designInfo.h === "number" ? item.meta.designInfo.h : metadata.height };
        } catch { warnings.push({ code: "PREVIEW_INVALID", severity: "degraded", message: "Preview is not a readable image." }); }
      }
    }
    if (!structured && !preview) throw upstreamError("MOONVY_DESIGN_UNAVAILABLE", "No usable Genome or preview was returned for this item.", "Confirm the item is a processed design and that your session can view it.");
    if (!structured) warnings.push({ code: "STRUCTURED_SOURCE_UNAVAILABLE", severity: "degraded", message: "Genome unavailable; preview output has low confidence." });
    const assets = autoDownloadAssets ? await downloadAssets(structured, outputDir, files, warnings, source => this.safeBuffer(source, warnings, "slice")) : undefined;
    return { sourceUrl: url, params, structured, sourceType: structured ? "genome" : "preview-image", preview, assets, files, warnings };
  }

  /** Executes official POST queries or credential-isolated resource GETs with sanitized errors. */
  private async requestJson(url: string, body?: Record<string, string>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, { method: body ? "POST" : "GET", headers: this.headers(url), body: body ? JSON.stringify(body) : undefined,
        redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch { throw upstreamError("MOONVY_NETWORK_ERROR", "Moonvy request failed or timed out.", "Check connectivity and retry."); }
    if (response.status === 401 || response.status === 403) throw upstreamError("MOONVY_ACCESS_DENIED", `Moonvy rejected access (HTTP ${response.status}).`, "Refresh your configured session and confirm project access.");
    if (!response.ok) throw upstreamError("MOONVY_HTTP_ERROR", `Moonvy request failed (HTTP ${response.status}).`);
    let value: unknown;
    try { value = await response.json(); }
    catch { throw upstreamError("MOONVY_INVALID_RESPONSE", "Moonvy response was not JSON."); }
    if (isRecord(value) && (value.error || value.ok === false || value.success === false || (typeof value.status === "number" && value.status >= 400))) throw upstreamError("MOONVY_API_ERROR", "Moonvy reported an API error.", "Confirm that your login session can access this design.");
    return value;
  }

  /** Individual binary failures become warnings while parsing can continue. */
  private async safeBuffer(url: string, warnings: PipelineWarning[], stage: string): Promise<Buffer | undefined> {
    try {
      if (!httpsUrl(url)) throw new Error("Invalid resource URL");
      const response = await fetch(url, { headers: this.headers(url), redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error("Resource unavailable");
      return Buffer.from(await response.arrayBuffer());
    } catch {
      warnings.push({ code: "ASSET_FETCH_FAILED", severity: "degraded", message: `Could not download ${stage} image.` });
      return undefined;
    }
  }

  /** Session headers are restricted to the exact API origin; CDN requests remain credential-free. */
  private headers(url: string): HeadersInit {
    const headers: Record<string, string> = { Accept: "application/json,text/plain,*/*", Referer: "https://moonvy.com/" };
    if (!httpsUrl(url)) throw upstreamError("MOONVY_UNSAFE_RESOURCE_URL", "Moonvy resource URL must use HTTPS without embedded credentials.");
    if (new URL(url).origin === "https://api.moonvy.com") {
      headers["Content-Type"] = "application/json";
      if (this.credentials.authorization) headers.Authorization = this.credentials.authorization;
      if (this.credentials.cookie) headers.Cookie = this.credentials.cookie;
    }
    return headers;
  }
}

/** Official API result envelopes are distinct from the Genome document itself. */
export function unwrapMoonvyEnvelope(value: unknown): unknown {
  return isRecord(value) ? value.result ?? value.data ?? value : value;
}

/** Accepts source HTTPS URLs without URL userinfo; rejected strings never enter fetch headers. */
function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
