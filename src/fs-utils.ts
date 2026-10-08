import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Ensures that a directory exists before writing pipeline artifacts. */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Returns a stable SHA-256 digest for idempotent write decisions. */
function digest(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Writes content only when it differs from an existing file. */
export async function writeTextIfChanged(path: string, content: string): Promise<{ path: string; bytes: number; status: "written" | "skipped" | "overwritten" }> {
  await ensureDir(dirname(path));
  const nextDigest = digest(content);
  try {
    const existing = await readFile(path);
    if (digest(existing) === nextDigest) {
      return { path: resolve(path), bytes: existing.byteLength, status: "skipped" };
    }
    await writeFile(path, content);
    return { path: resolve(path), bytes: Buffer.byteLength(content), status: "overwritten" };
  } catch {
    await writeFile(path, content);
    return { path: resolve(path), bytes: Buffer.byteLength(content), status: "written" };
  }
}

/** Writes binary content only when it differs from an existing file. */
export async function writeBufferIfChanged(path: string, content: Buffer): Promise<{ path: string; bytes: number; status: "written" | "skipped" | "overwritten" }> {
  await ensureDir(dirname(path));
  const nextDigest = digest(content);
  try {
    const existing = await readFile(path);
    if (digest(existing) === nextDigest) {
      return { path: resolve(path), bytes: existing.byteLength, status: "skipped" };
    }
    await writeFile(path, content);
    return { path: resolve(path), bytes: content.byteLength, status: "overwritten" };
  } catch {
    await writeFile(path, content);
    return { path: resolve(path), bytes: content.byteLength, status: "written" };
  }
}

/** Reads and parses JSON from a local fixture or previously fetched raw file. */
export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Returns a file size or zero when the path is unavailable. */
export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
