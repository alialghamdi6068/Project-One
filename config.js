require('dotenv').config();

const csv = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);

module.exports = {
  bot: {
    name: 'Project One',
    prefix: process.env.PREFIX || '!',
    owners: csv(process.env.OWNER_IDS),
    activity: process.env.BOT_ACTIVITY || 'Project One'
  },
  colors: { primary: 0x5865F2, success: 0x57F287, danger: 0xED4245, warning: 0xFEE75C, info: 0x5DADE2 },
  database: {
    file: process.env.DB_FILE || './data/database.json',
    backupFile: process.env.DB_BACKUP || './data/database.backup.json'
  },
  logs: {
    enabled: true,
    channelId: '',
    events: {
      messageDelete: true, messageUpdate: true, memberJoin: true, memberLeave: true,
      memberUpdate: true, moderation: true, role: true, channel: true, server: true,
      voice: true, ticket: true, protection: true, webhook: true, automod: true,
      giveaway: true, command: true
    }
  },
  protection: {
    enabled: true,
    whitelistUserIds: csv(process.env.WHITELIST_USER_IDS),
    whitelistRoleIds: csv(process.env.WHITELIST_ROLE_IDS),
    spam: { enabled: true, maxMessages: 6, windowMs: 5000, timeoutMs: 60000 },
    mentions: { enabled: true, maxMentions: 8 },
    links: { enabled: true, blockInvites: true },
    caps: { enabled: false, threshold: 0.8, minimumLength: 12 },
    raid: { enabled: true, joins: 8, windowMs: 10000, timeoutMs: 300000, lockdown: false },
    antiBot: { enabled: false, action: 'kick' },
    antiNuke: {
      enabled: true, windowMs: 10000, maxActions: 3, action: 'ban',
      events: ['CHANNEL_DELETE','ROLE_DELETE','MEMBER_BAN_ADD','MEMBER_KICK','WEBHOOK_CREATE','WEBHOOK_DELETE']
    },
    restore: { enabled: true, snapshotIntervalMs: 60000, maxSnapshots: 25, autoRestoreDeletedChannels: false, autoRestoreDeletedRoles: false }
  },
  commands: { cooldownMs: 1500, customPermissions: {}, maxConcurrentPerUser: 1 },
  automod: {
    enabled: true, badWords: [], deleteMessages: true, warnOnViolation: true,
    maxWarnings: 3, timeoutMs: 600000,
    rules: [], exceptions: { userIds: [], roleIds: [], channelIds: [] },
    duplicate: { enabled: true, max: 3, windowMs: 10000 },
    mentions: { enabled: true, max: 8 },
    invites: { enabled: true },
    links: { enabled: false, blockedDomains: [] }
  },
  moderation: { defaultReason: 'No reason provided', maxWarnsBeforeTimeout: 3, warnTimeoutMs: 600000 },
  permissions: { ownerBypass: true, enforceHierarchy: true },
  tickets: {
    enabled: true, categoryId: '', staffRoleId: '', naming: 'ticket-{number}',
    panelTitle: 'Support Tickets', panelDescription: 'اختر نوع التذكرة من الأزرار.',
    types: ['support','bug','partnership','developer'], transcript: true
  },
  welcome: { enabled: false, channelId: '', message: 'Welcome {user} to {server}!' },
  goodbye: { enabled: false, channelId: '', message: '{user} left {server}.' },
  autorole: { enabled: false, roleId: '' },
  autoreply: { enabled: true, rules: [] },
  suggestions: { enabled: true, channelId: '', approvalButtons: true, allowDownvote: true, staffRoleId: '' },
  giveaways: { enabled: true, minAccountAgeMs: 0, minMembers: 0 },
  levels: { enabled: true, xpPerMessage: 5, cooldownMs: 60000, xpPerLevel: 100, rewards: {} },
  economy: { enabled: true, currency: 'Credits', dailyAmount: 100, dailyCooldownMs: 86400000, startingBalance: 0, maxTransfer: 1000000000 },
  api: { enabled: false, baseUrl: '' }
};