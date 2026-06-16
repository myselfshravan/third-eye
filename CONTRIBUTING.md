# Contributing to third-eye

Thanks for your interest in improving third-eye! This guide covers everything
you need to get productive quickly.

## Code of Conduct
This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Ways to contribute
- 🐛 **Report bugs** — open an issue with a reproducible example (the URL that
  failed, the request body, and what you got vs. expected).
- 💡 **Suggest features** — open a feature request describing the use case.
- 📖 **Improve docs** — README, DEPLOY, CLAUDE.md, or code comments.
- 🔧 **Send code** — bug fixes, new device profiles, readiness heuristics,
  storage/queue backends, etc.

## Development setup
```bash
git clone https://github.com/myselfshravan/third-eye.git
cd third-eye
cp .env.example .env
npm install
npm run browsers:install        # one-time: Chromium + OS deps

# Verify the engine end-to-end (no server/Redis needed):
npm run smoke -- https://example.com
```

For the full stack (API + worker + Redis):
```bash
docker compose up --build
```

## Before you open a PR
Run the full local gate — CI runs the same checks:
```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Project layout & conventions
- See [CLAUDE.md](CLAUDE.md) for the architecture, the two things that matter
  most (the readiness oracle and the browser pool), and conventions.
- TypeScript ESM, Node ≥22. Relative imports end in `.js` (NodeNext).
- [`src/core/schema.ts`](src/core/schema.ts) is the single source of truth for
  the request contract — don't duplicate validation elsewhere.
- All config goes through [`src/core/config.ts`](src/core/config.ts)
  (validated at boot). Errors are typed `AppError`.
- Keep readiness helpers best-effort (swallow their own timeouts); only
  navigation/overall-timeout should hard-fail a capture.

## Commit & PR guidelines
- Use clear, present-tense commit messages (Conventional Commits encouraged:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Keep PRs focused; one logical change per PR.
- Add/adjust tests for behavioural changes (`*.test.ts`, run via Vitest).
- Update docs when you change the API contract or env vars.
- Link the issue your PR addresses (`Closes #123`).

## Adding a new device profile
Add an entry to `DEVICE_NAMES` in [`src/core/schema.ts`](src/core/schema.ts)
and the matching profile (viewport, DPR, UA, mobile/touch flags) in
[`src/capture/devices.ts`](src/capture/devices.ts). DPR matters — getting it
wrong yields blurry or mis-sized captures.

## Reporting security issues
Please **do not** open public issues for vulnerabilities. See
[SECURITY.md](SECURITY.md).

## License
By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
