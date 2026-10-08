import { join, resolve } from "node:path";
import { loadCredentials } from "./config.js";
import { writeTextIfChanged } from "./fs-utils.js";
import { MoonvyClient } from "./moonvy-client.js";
import { fixtureBundle, normalizeToUiTree } from "./normalize.js";
import { generatePrompt } from "./prompt.js";
import type { SourceBundle, UiTreeDocument } from "./types.js";

/** Fetches raw sources and default-on slice assets; callers can disable slices via downloadAssets. */
export async function fetchCommand(url: string, outDir: string, envFile?: string, downloadAssets = true): Promise<SourceBundle> {
  const client = new MoonvyClient(loadCredentials(envFile));
  return client.fetchSources(url, outDir, downloadAssets);
}

/** Converts either fetched Moonvy data or a fixture JSON object into a UI tree. */
export async function treeFromBundle(bundle: SourceBundle, outDir: string): Promise<{ document: UiTreeDocument; file: { path: string; bytes: number; status: string } }> {
  const document = normalizeToUiTree(bundle);
  const written = await writeTextIfChanged(join(outDir, "ui-tree.json"), JSON.stringify(document, null, 2));
  return { document, file: written };
}

/** Converts a local JSON fixture into a UI tree document and writes it to disk. */
export async function treeFromFixture(path: string, source: unknown, outDir: string): Promise<{ document: UiTreeDocument; file: { path: string; bytes: number; status: string } }> {
  return treeFromBundle(fixtureBundle(resolve(path), source), outDir);
}

/** Writes the generated AI implementation prompt for an existing UI tree document. */
export async function promptFromTree(document: UiTreeDocument, outDir: string): Promise<{ prompt: string; file: { path: string; bytes: number; status: string } }> {
  const prompt = generatePrompt(document);
  const written = await writeTextIfChanged(join(outDir, "prompt.md"), prompt);
  return { prompt, file: written };
}

/** Runs fetch, tree, prompt and manifest generation, forwarding the default-on slice download setting. */
export async function runPipeline(url: string, outDir: string, envFile?: string, downloadAssets = true): Promise<{ bundle: SourceBundle; document: UiTreeDocument; files: Array<{ path: string; type: string; bytes: number; status?: string }> }> {
  const bundle = await fetchCommand(url, outDir, envFile, downloadAssets);
  const tree = await treeFromBundle(bundle, outDir);
  const prompt = await promptFromTree(tree.document, outDir);
  const files = [
    ...bundle.files,
    { path: tree.file.path, type: "ui-tree", bytes: tree.file.bytes, status: tree.file.status },
    { path: prompt.file.path, type: "prompt", bytes: prompt.file.bytes, status: prompt.file.status }
  ];
  const manifest = {
    sourceUrl: url,
    generatedAt: tree.document.meta.generatedAt,
    sourceType: tree.document.meta.sourceType,
    confidence: tree.document.meta.confidence,
    warnings: tree.document.warnings,
    assets: bundle.assets,
    files
  };
  const manifestFile = await writeTextIfChanged(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  files.push({ path: manifestFile.path, type: "manifest", bytes: manifestFile.bytes, status: manifestFile.status });
  return { bundle, document: tree.document, files };
}

