# Project One

Production-oriented Discord bot built with Discord.js 14 and Node.js 20+.

## Included systems

- Moderation: ban, kick, unban, timeout, warnings, purge, locks and slowmode.
- Protection: anti-spam, anti-raid, anti-bot, mass mentions, invite filtering, caps filtering and configurable anti-nuke.
- Audit protection: channel/role/guild changes, webhook audit events and actor tracking.
- Tickets: multi-type panels, per-guild numbering, staff claim, close confirmation, reopen, admin delete, member management, ownership transfer, transcripts and inactivity auto-close.
- AutoMod: blocked words, duplicate-message detection, mention/invite protection, domain rules, exceptions and warning escalation.
- Suggestions: persistent up/down voting, staff approval/rejection and statistics.
- Giveaways: entry validation, multiple winners, persistent completion state, cancellation and rerolls.
- Levels: XP, levels, leaderboards and configurable role rewards.
- Economy: balance, daily rewards, transfers, transaction history, leaderboard and admin balance controls.
- Automation: reminders and scheduled messages with persistent storage.
- Community utilities: AFK, welcome, goodbye, autorole, autoreplies and announcements.
- Arabic prefix aliases plus slash commands.
- JSON database with atomic writes, backup fallback, validation and graceful shutdown.
- All major behavior is configuration-driven.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DISCORD_TOKEN`, `CLIENT_ID` and `OWNER_IDS`.
5. Start with `npm start`.

## Configuration

Edit `config.js` for defaults. Per-server settings are stored in the database where supported.

## Verification

Run:

```bash
npm test
node --check src/index.js
node --check config.js
```

No website or dashboard is required for the bot.
