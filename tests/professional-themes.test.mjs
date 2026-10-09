import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const required=['FP_THEMES','Dark theme','Emerald Intelligence','Executive Slate','Aurora Finance','openThemePicker','applyFPTheme','finpilot_theme','themeModal','visualHero'];
for(const x of required) if(!html.includes(x)) throw new Error('Missing theme system element: '+x);
const count=(html.match(/id:'(?:obsidian|emerald|executive|aurora)'/g)||[]).length;
if(count!==4) throw new Error('Expected exactly 4 visual themes, found '+count);
if(!html.includes("localStorage.setItem('finpilot_theme'")) throw new Error('Theme persistence missing');
if(!html.includes("localStorage.getItem('finpilot_theme')||'obsidian'")) throw new Error('Obsidian default missing');

const analysisScript = fs.readFileSync(new URL('../public/one-click-analysis.js',import.meta.url),'utf8');
assert.doesNotMatch(analysisScript, /marketReport&&marketSnapshot&&!marketSnapshot\.quality\?\.forecastEligible\)marketReport=\{\.\.\.marketReport,live:false\}/, 'forecast tracking eligibility alone must not invalidate a fresh quote');
assert.match(analysisScript, /symbolsMatch&&pricesMatch/, 'snapshot/report ticker and price must match before allowing scenario calculations');
assert.match(analysisScript, /Market snapshot and report do not match/, 'mismatched snapshot/report data must remain blocked with a clear reason');

console.log('professional theme tests passed');

const analysis = fs.readFileSync(new URL('../public/one-click-analysis.js',import.meta.url),'utf8');
const unsafeLightPanelStyles = [
  'background:linear-gradient(180deg,#f8faff,#fff)',
  'border:1px solid #315efb;background:#eef5ff',
  'border:1px solid #cbd7ee;background:#fff',
  'border:1px solid #d8e0ef;background:#fbfcff',
  'border:1px solid #cfd8ea;background:#fff',
  'border:2px solid #315efb;background:#f7f9ff'
];
for (const style of unsafeLightPanelStyles) {
  if (analysis.includes(style)) throw new Error('Theme-breaking hard-coded One-Click panel style remains: '+style);
}
const themeAwarePanelStyles = [
  'background:linear-gradient(180deg,var(--surface-2),var(--surface))',
  'border:1px solid var(--accent);background:var(--surface-2)',
  'border:1px solid var(--line);background:var(--surface)',
  'border:1px solid var(--line);background:var(--surface-2)'
];
for (const style of themeAwarePanelStyles) {
  if (!analysis.includes(style)) throw new Error('Missing theme-aware One-Click panel style: '+style);
}
console.log('One-Click Analysis theme contrast regression checks passed');

