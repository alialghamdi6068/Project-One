const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
for(const f of ['src/index.js','config.js','package.json']) if(!fs.existsSync(f)) throw new Error('Missing '+f);
execFileSync(process.execPath,['--check','src/index.js'],{stdio:'inherit'});
JSON.parse(fs.readFileSync('package.json','utf8'));
console.log('Project One smoke checks: OK');
