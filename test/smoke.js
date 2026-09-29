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
if (!source.includes("for(const guild of client.guilds.cache.values())")) {
  throw new Error('Multi-guild slash-command registration is missing');
}
if (!source.includes("await guild.commands.set(commandData)")) {
  throw new Error('Guild slash-command registration is missing');
}
if (!source.includes("await client.application.commands.set([])")) {
  throw new Error('Stale global slash-command cleanup is missing');
}

for (const marker of [
  "setName('leaderboard')",
  "setName('economy-top')",
  "setName('automod-rule')",
  "setName('economy-admin')",
  'guildAuditLogEntryCreate',
  'Ticket Auto-Closed',
  'delete db.tickets[c.id]',
  'g.guildId!==i.guild.id',
  "r.type==='domain'",
  'config.tickets.types||[]',
  'client.login(process.env.DISCORD_TOKEN).catch'
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

const generatedCommands = ['ban', 'kick', 'lock', 'unlock'];
const literalPlusGenerated = new Set([...slashNames, ...generatedCommands]);
if (literalPlusGenerated.size !== 66) {
  throw new Error('Expected 66 slash commands, found ' + literalPlusGenerated.size);
}
for (const name of generatedCommands) {
  if (!source.includes("setName('" + name + "')") && !source.includes("modCommand('" + name + "'") && !source.includes("[['lock',true],['unlock',false]]")) {
    throw new Error('Generated command definition missing: ' + name);
  }
}
if (!source.includes("GatewayIntentBits.GuildVoiceStates")) {
  throw new Error('GuildVoiceStates intent is missing');
}
if (source.includes("GatewayIntentBits.GuildPresences")) {
  throw new Error('Unused GuildPresences intent should not be requested');
}
if (!source.includes("verifyGatewayIntents()")) {
  throw new Error('Gateway intent verification is missing');
}
if (!source.includes("protection.antiBot.enabled")) {
  throw new Error('Anti-Bot protection path is missing');
}
if (!source.includes("const protection=protectionFor(m.guild)")) {
  throw new Error('Per-guild protection configuration is missing from member join handling');
}
if (!source.includes("data.setDefaultMemberPermissions(null)")) {
  throw new Error('Slash command visibility guard is missing');
}
if (!source.includes("const requiredPermissions = json.default_member_permissions")) {
  throw new Error('Command permission metadata is not captured');
}
if (!source.includes("config.permissions.ownerBypass && owner(i.user.id)")) {
  throw new Error('Owner permission bypass is missing');
}
if (!source.includes("Bulk slash registration failed")) {
  throw new Error('Individual slash registration fallback is missing');
}
if (!source.includes("labels[type] ||")) {
  throw new Error('Custom ticket type labels are not supported');
}

if (!source.includes("getUser:n=>values[n]?.user??values[n]??null")) {
  throw new Error('Prefix user option adapter is broken');
}
if (!source.includes("if(cursor<args.length)throw new Error('Too many arguments.')")) {
  throw new Error('Prefix extra-argument validation is missing');
}

if (pkg.engines?.node !== '>=20.0.0') {
  throw new Error('Node engine mismatch');
}

console.log('Project One smoke checks: OK');
