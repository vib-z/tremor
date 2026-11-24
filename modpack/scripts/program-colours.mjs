// Native pictures need one fixed fill. The pack's own SVG masks and markColor remain untouched.
// Herdr@2405bf3 settings.rs:293-336 resolves Paper/Graphite; stock new-menu uses popover,
// Agents uses chrome. Hover/selection are recorded separately: no backing is added to the artwork.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrast, fromHsl } from '../adapters/tokens.js';
const P = fileURLToPath(new URL('../', import.meta.url));
const mix = (a,b,t) => '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
const themes = {};
for (const [name,bg,light] of [['paper','#ffffff',true],['graphite','#17191d',false]]) {
 const chrome=mix(bg,light?'#e8e8e2':'#000000',light?.6:.32), popover=light?bg:mix(bg,'#ffffff',.06);
 themes[name]={chrome,popover,hoverChrome:mix(chrome,light?'#000000':'#ffffff',(light?12:14)/255),selectedChrome:mix(chrome,light?'#000000':'#ffffff',(light?18:23)/255),menuHover:mix(popover,light?'#000000':'#ffffff',(light?18:23)/255)};
}
for(const name of ['pdk-t3-light','pdk-t3-dark','pdk-moshi','pdk-moshi-forest']) {
 const {colors:t}=JSON.parse(readFileSync(`${P}themes/${name}.json`,'utf8'));
 themes[name]={chrome:t.chrome,popover:t.popover,hoverChrome:t.hover,selectedChrome:t.selected,menuHover:t.selected};
}
export const grounds = themes;
// Preserve the brand's exact HSL hue/saturation, changing only lightness; 0.01-point search from it.
export function hsl(hex) {
 const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),lo=Math.min(...rgb),hi=Math.max(...rgb),d=hi-lo,l=(lo+hi)/2;
 if(!d)return [0,0,l*100];const [r,g,b]=rgb;
 const h=hi===r?(g-b)/d+(g<b?6:0):hi===g?(b-r)/d+2:(r-g)/d+4;
 return [h*60,d/(1-Math.abs(2*l-1))*100,l*100];
}
export function nearest(brand,gs) {
 const pass=c=>gs.every(g=>contrast(c,g)>=3);if(pass(brand))return {color:brand,lightnessStep:0};
 const [h,s,l]=hsl(brand);if(s<10)throw Error('A neutral picture has no same-hue shade; keep its native tint instead');
 for(let step=1;step<=10000;step++)for(const sign of [-1,1]) {
  const L=l+sign*step/100;if(L<0||L>100)continue;const color=fromHsl([h,s,L]);
  if(pass(color))return {color,lightnessStep:sign*step/100};
 }
 throw Error('No fixed shade passes the resting grounds');
}
export function build(check = false) {
const ui=readFileSync(`${P}shared/ui.js`,'utf8'), overlay=JSON.parse(readFileSync(`${P}pdk-programs.json`,'utf8'));
const rests=Object.values(themes).flatMap(t=>[t.chrome,t.popover]);
const result={rule:'brand if it passes every resting ground; otherwise nearest HSL lightness on a 0.01-point grid, exact brand hue/saturation; original 8-bit SVG paths unchanged',grounds:themes,marks:{}};
if (!check) mkdirSync(`${P}icons/agents-colour`,{recursive:true});
const output=(path,text)=>{if(check){if(readFileSync(path,'utf8')!==text)throw Error(`Regenerate ${path}`);}else writeFileSync(path,text);};
for(const key of Object.keys(overlay.programs)) {
 const brand=ui.match(new RegExp(`^  ${key}: \\{ name: "[^"]+", color: "(#[0-9a-f]+)"`,'m'))?.[1];if(!brand)throw Error(key);
 const chosen=nearest(brand,rests),src=readFileSync(`${P}icons/agents/${key}.svg`,'utf8');if(!src.includes('currentColor'))throw Error('Expected mask SVG');
 output(`${P}icons/agents-colour/${key}.svg`,src.replaceAll('currentColor',chosen.color));
 overlay.programs[key]={...overlay.programs[key],icon:`pdk/icons/agents-colour/${key}.svg`,tint:false,color:chosen.color};
 const ratios=Object.fromEntries(Object.entries(themes).map(([n,t])=>[n,Object.fromEntries(Object.entries(t).map(([role,g])=>[role,contrast(chosen.color,g)]))]));
 const exceptions=Object.entries(ratios).flatMap(([theme,rs])=>Object.entries(rs).filter(([,v])=>v<3).map(([role,ratio])=>({theme,role,ratio})));
 result.marks[key]={brand,...chosen,ratios,exceptions};
}
output(`${P}pdk-programs.json`,JSON.stringify(overlay,null,2)+'\n');
output(`${P}icons/agents-colour.json`,JSON.stringify(result,null,2)+'\n');
}
if (import.meta.main) build(process.argv.includes("--check"));
