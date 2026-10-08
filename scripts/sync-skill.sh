#!/usr/bin/env bash
# Publish only the two repository-maintained skill files; preserve unrelated installed metadata and resources.
set -euo pipefail

# Resolve the repository from this script so synchronization works from any working directory.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Allow an explicit destination for isolated validation; otherwise honor the active Codex home.
SKILL_DEST="${MOONVY_SKILL_DEST:-${CODEX_HOME:-$HOME/.codex}/skills/moonvy-ui-prompt}"

mkdir -p "$SKILL_DEST/scripts"
cp "$REPO_DIR/skills/moonvy-ui-prompt/SKILL.md" "$SKILL_DEST/SKILL.md"
cp "$REPO_DIR/skills/moonvy-ui-prompt/scripts/import_moonvy_ui.sh" "$SKILL_DEST/scripts/import_moonvy_ui.sh"
chmod +x "$SKILL_DEST/scripts/import_moonvy_ui.sh"
printf 'Synced Moonvy skill to %s\n' "$SKILL_DEST"
