<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Anthropic API cost — minimize spend on the real key

This project's `ANTHROPIC_API_KEY` (in `.env.local` / Vercel env vars) is real money the user pays for directly out of pocket, and they are cost-sensitive about it. A single day of debugging burned ~$7 of their budget on repeated real-API test runs (2026-06-29) — this must not happen again.

- **Default to fake/mocked Anthropic clients for logic verification.** `tests/unit/importParser.test.ts`'s `fakeClient` pattern is free — use it (or something like it) for anything that's really testing code logic, not actual model output quality.
- **If a real API call is genuinely necessary** (verifying actual parsing quality, not logic), use the smallest fixture that exercises the behavior — not the user's full real document — and run it once, not in a retry/iterate loop "just to be sure."
- **Before any session of real-API testing/verification that could add up** (more than a couple of calls, or anything looping/batched), tell the user the purpose and the rough expected call count/cost first, and let them decide whether to proceed — don't just go run it.
- This applies to Claude's own ad-hoc debugging scripts as much as to the app's actual code paths.
