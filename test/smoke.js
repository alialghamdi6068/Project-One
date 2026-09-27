const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
for(const f of ['src/index.js','config.js','package.json']) if(!fs.existsSync(f)) throw new Error('Missing '+f);
execFileSync(process.execPath,['--check','src/index.js'],{stdio:'inherit'});
execFileSync(process.execPath,['--check','config.js'],{stdio:'inherit'});
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const source=fs.readFileSync('src/index.js','utf8');
if((source.match(/client\.login/g)||[]).length!==1) throw new Error('Expected one login call');
if(source.includes('}\\nif (!Number.isInteger')) throw new Error('Escaped newline corruption');
for(const marker of ["setName('leaderboard')","setName('economy-top')","setName('automod-rule')","setName('economy-admin')",'guildAuditLogEntryCreate','Ticket Auto-Closed','delete db.tickets[c.id]']) {
  if(!source.includes(marker)) throw new Error('Missing required marker: '+marker);
}
const names=[...source.matchAll(/setName\('([^']+)'\)/g)].map(m=>m[1]);
const slashNames=[...source.matchAll(/SlashCommandBuilder\(\)\.setName\('([^']+)'\)/g)].map(m=>m[1]);
const duplicates=slashNames.filter((n,i)=>slashNames.indexOf(n)!==i);
if(duplicates.length) throw new Error('Duplicate slash commands: '+[...new Set(duplicates)].join(', '));
if(pkg.engines?.node!==' >=20.0.0'.trim()) throw new Error('Node engine mismatch');
console.log('Project One smoke checks: OK');
