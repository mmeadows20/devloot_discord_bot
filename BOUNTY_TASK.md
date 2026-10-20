# Bounty Objective: Implement interactive onboarding wizard for first-time bounty creation
Target: devloot-xyz/devloot_discord_bot Issue #15
URL: https://github.com/devloot-xyz/devloot_discord_bot/issues/15

## Issue Description
## Overview
Implement a guided Discord onboarding flow that walks users through creating and publishing their first bounty. The bot will guide the creator step-by-step, validate GitHub references and reward amounts, and publish the finalized bounty to a designated showcase channel.

## Scope
- Register a `/create-bounty` slash command that launches a private onboarding flow (ephemeral message or private thread).
- Multi-step interactive flow using Discord buttons, select menus, and modals to collect:
  - Bounty title and short summary
  - Target GitHub repository and issue URL (with regex validation)
  - Reward payout (amount and currency/token, e.g., USDC, SOL, ETH)
  - Optional completion deadline
- Draft preview step allowing the creator to review, edit fields, or cancel before publishing.
- Publication step that formats the bounty into a rich Discord embed and sends it to the configured `#bounties` announcement channel.
- Configurable channel IDs and environment variables for the bot via `.env`.

## Out of scope
- On-chain escrow contract deployments or direct wallet signature prompts (handled separately or externally).
- Full GitHub bidirectional webhooks integration (syncing issue closures back to Discord).
- Advanced multi-language localization.

## Acceptance criteria
- [ ] `/create-bounty` slash command is registered and responds with an interactive onboarding session.
- [ ] Input validation correctly identifies valid GitHub issue URLs and positive reward amounts.
- [ ] Creator can review draft details and modify any field before final submission.
- [ ] Finalized bounties are posted to the designated bounty channel with an organized embed card.
- [ ] User receives a confirmation message with a link to the published bounty post upon completion.
- [ ] Bot handles error states gracefully (e.g., timeout, invalid URLs, missing bot permissions in the target channel).

## Context
- Repository: `devloot-xyz/devloot_discord_bot`
- Ensure Discord bot permissions include `Send Messages`, `Embed Links`, and `Use Slash Commands`.

## Instructions for Kuro (Autonomous Solver):
1. Use skills: `systematic-debugging` and `code-review-and-quality`.
2. Inspect the repository structure, locate relevant files, and understand the bug/feature.
3. Apply the minimal, robust fix or implementation.
4. Run any existing test suites or linters in the workspace.
5. Ensure the fix adheres to the project's existing code style.
6. When done, output a summary of files modified and verification results.
