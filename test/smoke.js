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

for (const marker of [
  "for(const guild of client.guilds.cache.values())",
  "await guild.commands.set(commandData)",
  "await guild.commands.fetch()",
  "slash commands deployed and verified",
  "Slash deployment finished",
  "GatewayIntentBits.GuildVoiceStates",
  "verifyGatewayIntents()",
  "data.setDefaultMemberPermissions(null)",
  "const requiredPermissions = json.default_member_permissions",
  "config.permissions.ownerBypass && owner(i.user.id)",
  "protection.antiBot.enabled",
  "const protection=protectionFor(m.guild)",
  "Ticket Auto-Closed",
  "guildAuditLogEntryCreate",
  "g.guildId!==i.guild.id",
  "r.type==='domain'",
  "config.tickets.types||[]",
  "getUser:n=>values[n]?.user??values[n]??null",
  "if(cursor<args.length)throw new Error('Too many arguments.')",
  "client.login(process.env.DISCORD_TOKEN).catch"
]) {
  if (!source.includes(marker)) throw new Error('Missing required marker: ' + marker);
}

if (source.includes("GatewayIntentBits.GuildPresences")) {
  throw new Error('Unused GuildPresences intent should not be requested');
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

if (pkg.engines?.node !== '>=20.0.0') {
  throw new Error('Node engine mismatch');
}

console.log('Project One smoke checks: OK');
