# Project One

Professional Discord.js bot for moderation, protection, tickets, automation, community systems, and utility features.

## Included

- Discord.js 14 / Node.js 20+
- Slash commands + Arabic prefix aliases
- Moderation: ban, kick, unban, timeout, untimeout, warn, warning history, clear, lock, unlock, slowmode, role management
- Protection: anti-spam, anti-raid, anti-bot, invite filter, mass mentions, caps filter, anti-nuke audit monitoring, whitelist, escalating sanctions, lockdown
- AutoMod with configurable word list and warning escalation
- Audit logging with independent event toggles
- Tickets: Support, Bug Report, Partnership, Developer Support, per-server numbering, custom names, duplicate prevention, claim, close/reopen, admin delete, transcript logging
- Welcome/goodbye and autorole
- Autoreply, announcements, reminders
- Suggestions with approval/rejection buttons
- Giveaways
- Levels/XP
- Credits economy, balance, daily
- AFK
- Persistent JSON storage with atomic writes and a backup
- Central configuration in `config.js`
- No website and no dashboard

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DISCORD_TOKEN`, `CLIENT_ID`, and optionally `OWNER_IDS`.
5. Enable the required privileged intents in the Discord Developer Portal: **Server Members**, **Message Content**, and **Presence** if you use the related features.
6. Configure IDs and systems in `config.js`.
7. Run `npm test`, then `npm start`.

The bot never stores the Discord token in the repository.