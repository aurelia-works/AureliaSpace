## What and why

<!-- One or two sentences. -->

## Testing

<!-- Commands from CLAUDE.md → Verification and their result lines. Screenshots for UI changes (which preview view). Anything not tested, and why. -->

- [ ] `npx tsc --noEmit -p .`
- [ ] `npm test`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `npm run build`
- [ ] Screenshot check (UI changes)
- [ ] `/code-review` run on this diff (max 3 rounds)

## Risk

<!-- What could break, for whom, and how you'd notice. Saved state, chat protocol, worktrees, secrets? -->

## How to revert

<!-- Usually `git revert <sha>`. Say if saved state, config or anything outside the repo needs undoing too. -->
