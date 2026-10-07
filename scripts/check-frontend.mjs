import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(m=>m[1])
  .filter(s=>s.trim());
if(!scripts.length)throw new Error('No inline frontend script found');
for(const [i,source] of scripts.entries()){
  new vm.Script(source,{filename:`public/index.html:inline-script-${i+1}`});
}
console.log(`Frontend inline JavaScript syntax passed (${scripts.length} inline script block).`);
