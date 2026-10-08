#!/usr/bin/env bash

# Convert one Moonvy design link into AI-ready assets using the local moonvy-ui-prompt CLI.
set -euo pipefail

# A versioned helper locates its checkout; installed copies use an explicit override or conventional local checkout.
SCRIPT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEFAULT_TOOL_DIR="$HOME/Documents/GitHub/moonvy-ui-prompt"
if [[ -f "$SCRIPT_REPO/src/moonvy-client.ts" ]]; then
  DEFAULT_TOOL_DIR="$SCRIPT_REPO"
elif [[ ! -d "$DEFAULT_TOOL_DIR" && -d "$HOME/Documents/GitHub/moonvyPrompt" ]]; then
  DEFAULT_TOOL_DIR="$HOME/Documents/GitHub/moonvyPrompt"
fi
# The override lets an installed skill use a clone in any location, independent of the caller's app repository.
TOOL_DIR="${MOONVY_UI_PROMPT_DIR:-$DEFAULT_TOOL_DIR}"
CLI_PATH="$TOOL_DIR/dist/cli.js"
ENV_FILE="${MOONVY_ENV_FILE:-$TOOL_DIR/.env.local}"
OUTPUT_ROOT="${MOONVY_OUTPUT_ROOT:-$TOOL_DIR/output}"

# Caller supplies the URL first; only the slice-download switch is forwarded to keep output and credentials consistent.
MOONVY_URL="${1:-}"
if [[ $# -gt 0 ]]; then shift; fi
DOWNLOAD_FLAG="--download-assets"
for option in "$@"; do
  case "$option" in
    --download-assets|--no-download-assets) DOWNLOAD_FLAG="$option" ;;
    *) echo "Unsupported option: $option" >&2; exit 1 ;;
  esac
done
if [[ -z "$MOONVY_URL" ]]; then
  echo "请粘贴月维 UI 链接，然后按 Enter 确认：" >&2
  IFS= read -r MOONVY_URL
fi

# Markdown/web copies often HTML-escape ampersands; normalize before parsing.
MOONVY_URL="${MOONVY_URL//&amp;/&}"

if [[ -z "${MOONVY_URL// }" ]]; then
  echo "错误：月维链接为空。" >&2
  exit 1
fi

# Always compile current sources; set -e stops on build failure instead of running stale dist files.
(cd "$TOOL_DIR" && pnpm build) >&2

if [[ ! -f "$CLI_PATH" ]]; then
  echo "错误：无法找到 moonvy-ui-prompt CLI：$CLI_PATH" >&2
  exit 1
fi

PARSE_OUTPUT="$(node "$CLI_PATH" parse "$MOONVY_URL" --json)"
ITEM_KEY="$(printf '%s' "$PARSE_OUTPUT" | node -e 'let input=""; process.stdin.on("data", d => input += d); process.stdin.on("end", () => { const parsed = JSON.parse(input); const id = parsed.data?.itemId || ""; process.stdout.write(id ? id.slice(0, 8) : `moonvy-${Date.now()}`); });')"
OUT_DIR="$OUTPUT_ROOT/$ITEM_KEY"

node "$CLI_PATH" run "$MOONVY_URL" --out "$OUT_DIR" --env-file "$ENV_FILE" "$DOWNLOAD_FLAG" --json

echo
echo "MOONVY_UI_OUTPUT_DIR=$OUT_DIR"
echo "MOONVY_UI_PROMPT=$OUT_DIR/prompt.md"
echo "MOONVY_UI_TREE=$OUT_DIR/ui-tree.json"
echo "MOONVY_UI_MANIFEST=$OUT_DIR/manifest.json"

# Only advertise the index when downloads were requested; old output directories can retain earlier indexes.
if [[ "$DOWNLOAD_FLAG" != "--no-download-assets" && -f "$OUT_DIR/assets/index.json" ]]; then
  echo "MOONVY_UI_ASSETS=$OUT_DIR/assets/index.json"
fi
