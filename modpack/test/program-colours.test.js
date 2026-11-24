import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { contrast } from '../adapters/tokens.js';
import { grounds, hsl } from '../scripts/program-colours.mjs';
const P=new URL('..',import.meta.url).pathname, info=JSON.parse(readFileSync(`${P}/icons/agents-colour.json`,'utf8')), overlay=JSON.parse(readFileSync(`${P}/pdk-programs.json`,'utf8')).programs;
const delta=(a,b)=>Math.min(Math.abs(a-b),360-Math.abs(a-b));
test('native colour copies change only the fill, use pictures, and leave the per-theme masks intact',()=>{
 const ui=readFileSync(`${P}/shared/ui.js`,'utf8');expect(ui).toContain('markShade(brand, grounds) ?? t.foreground');
 for(const [key,m]of Object.entries(info.marks)){
  const original=readFileSync(`${P}/icons/agents/${key}.svg`,'utf8'),coloured=readFileSync(`${P}/icons/agents-colour/${key}.svg`,'utf8');
  expect(original).toContain('currentColor');expect(coloured).toBe(original.replaceAll('currentColor',m.color));expect(coloured).not.toContain('currentColor');
  expect(overlay[key].icon).toBe(`pdk/icons/agents-colour/${key}.svg`);expect(overlay[key].tint).toBe(false);expect(overlay[key].color).toBe(m.color);
  const a=hsl(m.brand),b=hsl(m.color);expect(delta(a[0],b[0]),key).toBeLessThan(1);expect(Math.abs(a[1]-b[1]),key).toBeLessThan(1);
 }
});
test('one static colour meets 3:1 on both native resting appearances; all lower hover/selected cases are enumerated',()=>{
 expect(Object.keys(grounds)).toEqual(["paper","graphite","pdk-t3-light","pdk-t3-dark","pdk-moshi","pdk-moshi-forest"]);
 expect(info.grounds).toEqual(grounds);
 for(const [key,m]of Object.entries(info.marks)){
  const exceptions=[];
  for(const [theme,t]of Object.entries(grounds))for(const [role,g]of Object.entries(t)){
   const ratio=contrast(m.color,g);expect(m.ratios[theme][role]).toBeCloseTo(ratio,10);
   if(['chrome','popover'].includes(role))expect(ratio,`${key} ${theme} ${role}`).toBeGreaterThanOrEqual(3);
   if(ratio<3)exceptions.push({theme,role,ratio});
  }
  expect(m.exceptions).toEqual(exceptions);
  if(m.lightnessStep===0)expect(m.color).toBe(m.brand);else expect(Object.values(grounds).some(t=>['chrome','popover'].some(k=>contrast(m.brand,t[k])<3)),key).toBe(true);
 }
});
test('coloured assets and exact contrast manifest regenerate deterministically',()=>{
 const r=Bun.spawnSync(['bun',`${P}/scripts/program-colours.mjs`,'--check']);expect(r.exitCode,r.stderr.toString()).toBe(0);
});
