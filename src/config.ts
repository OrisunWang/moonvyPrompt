import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MoonvyCredentials } from "./types.js";

/** CLI options parsed from command-line flags. */
export interface CliOptions {
  /** Whether stdout should use a JSON envelope. */
  json: boolean;
  /** Optional output directory or output file path. */
  out?: string;
  /** Whether positional input should be read as a local source JSON file. */
  fromFile: boolean;
  /** CLI parser defaults this to true; network commands use it to control slice downloads. */
  downloadAssets: boolean;
  /** Optional env file path used before process env fallback. */
  envFile?: string;
}

/** Parses a minimal `.env` file without adding a runtime dependency. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const entries: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) {
      continue;
    }
    const rawValue = match[2].trim();
    entries[match[1]] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return entries;
}

/** Loads Moonvy credentials from environment first, then `.env.local`. */
export function loadCredentials(envFile = ".env.local"): MoonvyCredentials {
  const fileValues = readEnvFile(resolve(process.cwd(), envFile));
  const cookie = process.env.MOONVY_COOKIE ?? fileValues.MOONVY_COOKIE;
  const authorization = process.env.MOONVY_AUTHORIZATION ?? fileValues.MOONVY_AUTHORIZATION;
  const source = process.env.MOONVY_COOKIE || process.env.MOONVY_AUTHORIZATION ? "env" : cookie || authorization ? ".env.local" : "missing";
  return { cookie, authorization, source };
}

/** Removes recognized flags and returns command options plus positional arguments. */
export function parseCliOptions(args: string[]): { options: CliOptions; positionals: string[] } {
  const options: CliOptions = { json: false, fromFile: false, downloadAssets: true };
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-download-assets") {
      options.downloadAssets = false;
    } else if (arg === "--download-assets") {
      options.downloadAssets = true;
    } else if (arg === "--from-file") {
      options.fromFile = true;
    } else if (arg === "--out" || arg === "-o") {
      options.out = args[index + 1];
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = args[index + 1];
      index += 1;
    } else {
      positionals.push(arg);
    }
  }
  return { options, positionals };
}
