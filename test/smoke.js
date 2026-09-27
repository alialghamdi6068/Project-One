const fs=require('node:fs');
const path=require('node:path');
const files=['src/index.js','config.js','package.json'];
for(const file of files){
  if(!fs.existsSync(path.resolve(__dirname,'..',file))) throw new Error('Missing '+file);
}
JSON.parse(fs.readFileSync(path.resolve(__dirname,'../package.json'),'utf8'));
console.log('Project One smoke checks: OK');
