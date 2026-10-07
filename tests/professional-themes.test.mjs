import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const required=['FP_THEMES','Quantum Obsidian','Emerald Intelligence','Executive Slate','Aurora Finance','openThemePicker','applyFPTheme','finpilot_theme','themeModal','visualHero'];
for(const x of required) if(!html.includes(x)) throw new Error('Missing theme system element: '+x);
const count=(html.match(/id:'(?:obsidian|emerald|executive|aurora)'/g)||[]).length;
if(count!==4) throw new Error('Expected exactly 4 visual themes, found '+count);
if(!html.includes("localStorage.setItem('finpilot_theme'")) throw new Error('Theme persistence missing');
if(!html.includes("localStorage.getItem('finpilot_theme')||'obsidian'")) throw new Error('Obsidian default missing');
console.log('professional theme tests passed');
