const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const requiredFiles = ['src/index.js', 'config.js', 'package.json'];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error('Missing ' + file);
}

execFileSync(process.execPath, ['--check', 'src/index.js'], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', 'config.js'], { stdio: 'inherit' });

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const source = fs.readFileSync('src/index.js', 'utf8');

if ((source.match(/client\.login/g) || []).length !== 1) throw new Error('Expected one login call');
if (source.includes('}\\nif (!Number.isInteger')) throw new Error('Escaped newline corruption');
if (!source.includes("const deployGuildId=process.env.GUILD_ID?.trim();")) {
  throw new Error('Guild ID handling is missing');
}
if (!source.includes("for(const guild of client.guilds.cache.values())")) {
  throw new Error('Multi-guild slash-command registration is missing');
}
if (!source.includes("await guild.commands.set(commandData)")) {
  throw new Error('Guild slash-command registration is missing');
}

for (const marker of [
  "setName('leaderboard')",
  "setName('economy-top')",
  "setName('automod-rule')",
  "setName('economy-admin')",
  'guildAuditLogEntryCreate',
  'Ticket Auto-Closed',
  'delete db.tickets[c.id]'
]) {
  if (!source.includes(marker)) throw new Error('Missing required marker: ' + marker);
}

const slashNames = [
  ...source.matchAll(/new SlashCommandBuilder\(\)\.setName\('([^']+)'\)/g)
].map(match => match[1]);

const duplicates = [...new Set(
  slashNames.filter((name, index) => slashNames.indexOf(name) !== index)
)];

if (duplicates.length) {
  throw new Error('Duplicate slash commands: ' + duplicates.join(', '));
}

if (slashNames.length < 50) {
  throw new Error('Unexpectedly low slash-command count: ' + slashNames.length);
}

if (pkg.engines?.node !== '>=20.0.0') {
  throw new Error('Node engine mismatch');
}

console.log('Project One smoke checks: OK');
