---
name: moonvy-ui-prompt
description: Convert Moonvy design links into UI trees, implementation prompts, and named PNG assets using the local moonvy-ui-prompt CLI. Use when the user asks to import, parse, convert, or generate UI implementation assets from Moonvy links.
---

# Moonvy UI Prompt

## Import

- Use the user's Moonvy design link; ask for one only when none is available.
- Run `scripts/import_moonvy_ui.sh "<moonvy-url>"` from this skill directory. Add `--no-download-assets` only when the user wants to skip slice downloads; they are enabled by default.
- The script builds the current local source before importing, so an existing `dist/` cannot silently supply an older implementation. Build failure stops the import.
- The versioned helper automatically uses its checkout. Installed copies check `$HOME/Documents/GitHub/moonvy-ui-prompt` then `$HOME/Documents/GitHub/moonvyPrompt`; set `MOONVY_UI_PROMPT_DIR` for other clone locations. Credentials come from the selected project's `.env.local`, and output goes to `output/<itemId-prefix>/`. Overrides: `MOONVY_UI_PROMPT_DIR`, `MOONVY_ENV_FILE`, and `MOONVY_OUTPUT_ROOT`.
- Provide clickable links to `prompt.md`, `ui-tree.json`, and `manifest.json`; also link `assets/index.json` when this run produced it. Inspect warnings and report missing or failed assets rather than claiming complete downloads.
- Do not copy assets into a target app unless the user requests that destination.

## Assets

- Visible exportable slices download by default. PNG variants use the UI name: `assets/unlock50/unlock50.png`, `unlock50@2x.png`, and `unlock50@3x.png`.
- Use `assets/index.json` to map layer IDs and original names to the canonical `assetName`, local PNG paths, densities, dimensions, and SHA-256 hashes. Use `assetName` for the iOS asset catalog; unsafe filename characters are sanitized and different content with conflicting names receives numeric suffixes.
- **相同的素材不要重复添加。** Identical complete variant sets reuse the first UI name. Before importing into an app, check existing assets by content and reuse them. @1x/@2x/@3x are variants of one material.
- PNGs are already extracted and ready to import. New imports do not generate redundant ZIPs. Matching legacy UI-named ZIPs are deleted only after all extracted files are verified; failed verification or deletion retains the ZIP with a warning. Do not blindly delete retained archives.
- Slice logical size may differ from its containing layer bounds. Preserve the catalog's size and density. Insufficient source resolution omits unavailable densities with a warning; unknown density remains explicitly marked as original.
- `--no-download-assets` skips slices, preserving preview behavior. Local CLI `--from-file` commands stay offline. Use the current run's manifest, not leftover files from prior imports, to determine what was generated.

## Handoff

1. Read `prompt.md`, then `ui-tree.json` as the source of truth for hierarchy, coordinates, visual styles, and typography.
2. For assets, read `assets/index.json` when listed in this run's manifest; reference `asset.localPath` and the canonical `assetName`.
3. Text bounds are reference geometry: keep text intrinsically sized and reflow dynamic content. Use spacing marked `reference-only` for verification, not fixed layout gaps.
4. Avoid revisiting Moonvy unless the user requests a fresh import.

## Credentials and maintenance

- Never print or paste `MOONVY_AUTHORIZATION` or `MOONVY_COOKIE`. If authentication fails, ask the user to refresh the configured env file.
- This installed skill is synchronized from the project's `skills/moonvy-ui-prompt/`. When developing the CLI, follow the repository's `AGENTS.md`: update the versioned skill and affected scripts alongside behavior changes, then run `bash scripts/sync-skill.sh` from the repository to update this installed copy.

Genome typography retains named font weights and explicit px, percent/% or em line heights. Automatic line height remains unspecified for intrinsic text sizing.

Node typing checks actual text values, so optional undefined adapter fields do not turn frames or shapes into text nodes.
