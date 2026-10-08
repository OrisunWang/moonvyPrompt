# Development constraints

- Never modify existing signing certificates, Release signing, Development Team, Code Signing Identity, Provisioning Profiles, Entitlements or Bundle IDs without explicit user confirmation. New Apple extension placeholders may use only the literal prefix `com..aaaaa.`.
- For Apple applications, prefer Swift/SwiftUI and Apple Human Interface Guidelines; document justified UIKit/AppKit use.
- Every new or changed type, function, property, state, dependency and principal UI component requires maintenance comments explaining its responsibility. Explain business rules, state transitions, boundaries, errors and concurrency decisions.
- Write product documentation before new implementation. Existing code is the factual source for behavior; synchronize documentation with changes.

# Development workflow

These project instructions supplement the user's global development constraints.

## Keep the CLI and skill synchronized

- When adding or changing CLI behavior, review and update the corresponding documentation and `skills/moonvy-ui-prompt/SKILL.md` in the same task. Update `skills/moonvy-ui-prompt/scripts/import_moonvy_ui.sh` when invocation, flags, build requirements, or output handoff changes.
- Treat `skills/moonvy-ui-prompt/` as the version-controlled skill source. Do not maintain changes solely in the installed copy.
- After relevant changes, validate the skill, run affected tests and `pnpm build`, then run `bash scripts/sync-skill.sh` to update the installed skill. Its default destination is `${CODEX_HOME:-$HOME/.codex}/skills/moonvy-ui-prompt`; `MOONVY_SKILL_DEST` can override it for isolated validation.
- Verify the installed files match the versioned copies. If installation is blocked, report the concrete blocker and distinguish completed repository changes from unsynchronized installed files.
- Include the relevant skill and script changes when committing a feature. Unrelated changes need only a compatibility review, not artificial edits to the skill.
- Preserve the default-on downloads, UI-derived asset names, content reuse, and verified ZIP cleanup in handoff guidance when these behaviors are unchanged.
