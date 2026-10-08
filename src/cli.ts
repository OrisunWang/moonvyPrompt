#!/usr/bin/env node
import { resolve } from "node:path";
import { parseCliOptions } from "./config.js";
import { loadCredentials } from "./config.js";
import { normalizeError, usageError } from "./errors.js";
import { readJsonFile } from "./fs-utils.js";
import { MoonvyClient } from "./moonvy-client.js";
import { fetchCommand, promptFromTree, runPipeline, treeFromBundle, treeFromFixture } from "./pipeline.js";
import { parseMoonvyUrl } from "./url.js";
import type { CliEnvelope, PipelineWarning, UiTreeDocument } from "./types.js";

/** Package version embedded in CLI envelopes and `--version` output. */
const VERSION = "0.1.0";

/** Help text shown when the command or arguments are incomplete. */
const HELP = `moonvy-ui-prompt

Usage:
  moonvy-ui-prompt parse <url> [--json]
  moonvy-ui-prompt fetch <url> --out <dir> [--json]
  moonvy-ui-prompt tree <url|file> --out <dir> [--from-file] [--json]
  moonvy-ui-prompt prompt <url|ui-tree.json> --out <dir> [--from-file] [--json]
  moonvy-ui-prompt run <url> --out <dir> [--json]
  moonvy-ui-prompt auth test [--json]

Assets:
  Slice downloads are enabled by default for network commands.
  --no-download-assets disables slices; --download-assets enables them.
  Local --from-file commands stay offline.

Credentials:
  MOONVY_AUTHORIZATION (full Bearer header) is required for network commands.
  MOONVY_COOKIE is optional.
`;

/** Program entrypoint that wraps command errors into safe envelopes. */
async function main(): Promise<void> {
  const start = Date.now();
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const { options, positionals } = parseCliOptions(rest);
  try {
    const data = await dispatch(command, positionals, options);
    writeSuccess(command, data, [], options.json, Date.now() - start);
  } catch (error) {
    const normalized = normalizeError(error);
    writeFailure(command, normalized.toWarning(), options.json, Date.now() - start);
    process.exitCode = normalized.exitCode;
  }
}

/** Routes parsed CLI arguments to the matching command implementation. */
async function dispatch(command: string, positionals: string[], options: ReturnType<typeof parseCliOptions>["options"]): Promise<unknown> {
  if (command === "parse") {
    const input = await requireInput(positionals[0]);
    return parseMoonvyUrl(input);
  }

  if (command === "auth" && positionals[0] === "test") {
    const credentials = loadCredentials(options.envFile);
    const client = new MoonvyClient(credentials);
    return { ...client.authStatus() };
  }

  if (command === "fetch") {
    const input = await requireInput(positionals[0]);
    const outDir = requireOutDir(options.out);
    const bundle = await fetchCommand(input, outDir, options.envFile, options.downloadAssets);
    return { sourceType: bundle.sourceType, files: bundle.files, warnings: bundle.warnings };
  }

  if (command === "tree") {
    const input = await requireInput(positionals[0]);
    const outDir = requireOutDir(options.out);
    if (options.fromFile) {
      const result = await treeFromFixture(input, await readJsonFile(input), outDir);
      return { file: result.file, warnings: result.document.warnings, sourceType: result.document.meta.sourceType };
    }
    const bundle = await fetchCommand(input, outDir, options.envFile, options.downloadAssets);
    const result = await treeFromBundle(bundle, outDir);
    return { file: result.file, warnings: result.document.warnings, sourceType: result.document.meta.sourceType };
  }

  if (command === "prompt") {
    const input = await requireInput(positionals[0]);
    const outDir = requireOutDir(options.out);
    if (options.fromFile) {
      const document = await readJsonFile(input) as UiTreeDocument;
      const result = await promptFromTree(document, outDir);
      return { file: result.file };
    }
    const bundle = await fetchCommand(input, outDir, options.envFile, options.downloadAssets);
    const tree = await treeFromBundle(bundle, outDir);
    const result = await promptFromTree(tree.document, outDir);
    return { file: result.file, warnings: tree.document.warnings, sourceType: tree.document.meta.sourceType };
  }

  if (command === "run") {
    const input = await requireInput(positionals[0]);
    const outDir = requireOutDir(options.out);
    const result = await runPipeline(input, outDir, options.envFile, options.downloadAssets);
    return { sourceType: result.document.meta.sourceType, confidence: result.document.meta.confidence, files: result.files, warnings: result.document.warnings };
  }

  throw usageError("UNKNOWN_COMMAND", `Unknown command: ${command}`, "Run `moonvy-ui-prompt --help` for available commands.");
}

/** Reads positional input, supporting `-` as stdin for pipe workflows. */
async function requireInput(value: string | undefined): Promise<string> {
  if (!value) {
    throw usageError("MISSING_INPUT", "A URL or file path is required.", "Pass a Moonvy /project/<projectId>/<folderId>/<itemId> design URL, or use `--from-file` with a local JSON fixture.");
  }
  if (value === "-") {
    return readStdin();
  }
  return value;
}

/** Ensures output directory is explicitly provided for mutating commands. */
function requireOutDir(value: string | undefined): string {
  if (!value) {
    throw usageError("MISSING_OUTPUT_DIR", "`--out <dir>` is required for this command.", "Use `.moonvy.local/page-name` for local generated artifacts.");
  }
  return resolve(value);
}

/** Reads stdin as UTF-8 text. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Writes a successful command response in JSON envelope or human-readable form. */
function writeSuccess(command: string, data: unknown, warnings: PipelineWarning[], json: boolean, durationMs: number): void {
  if (json || !process.stdout.isTTY) {
    const envelope: CliEnvelope<unknown> = { ok: true, command, data, warnings, meta: { version: VERSION, durationMs } };
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/** Writes a failed command response while keeping secrets out of the message. */
function writeFailure(command: string, error: PipelineWarning, json: boolean, durationMs: number): void {
  if (json || !process.stdout.isTTY) {
    const envelope: CliEnvelope<unknown> = { ok: false, command, error, meta: { version: VERSION, durationMs } };
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }
  process.stderr.write(`[${error.code}] ${error.message}${error.hint ? `\n${error.hint}` : ""}\n`);
}

main();
