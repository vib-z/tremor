import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PACK = new URL("..", import.meta.url).pathname;
const ROOT = mkdtempSync(join(tmpdir(), "pdk-native-test-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
for (const dir of ["lib", "guide"]) mkdirSync(join(ROOT, dir));
writeFileSync(join(ROOT,"stub.js"), `
export const element=kind=>{const o={kind,ops:[]};let p;p=new Proxy(o,{get(o,k){if(k in o||k==="then"||typeof k==="symbol")return o[k];return(...a)=>{if(k==="when"){if(a[0])a[1](p);return p;}o.ops.push([k,...a]);return p;};}});return p;};
export class View {}
export const div=()=>element("div"),svg=()=>element("svg"),h_flex=()=>element("h_flex"),v_flex=()=>element("v_flex");
export const Button={new:id=>element("Button").id(id)},Toggle={new:id=>element("Toggle").id(id)},Progress={new:id=>element("Progress").id(id)},ProgressTrack={new:()=>element("ProgressTrack")},ProgressIndicator={new:()=>element("ProgressIndicator")},HoverCard={new:id=>element("HoverCard").id(id)},Popover={new:id=>element("Popover").id(id)};
export const state={};
export const InputState={new(){let value="";return{events:{},on(k,fn){this.events[k]=fn;},value:()=>value,set_value(v){value=v;},focus(){}};}};
export const Input={new:s=>{const e=element("input");e.input=s;return e;}},TextView={html:(id,html)=>{const e=element("text");e.html=html;return e;}};
export const keys=()=>[];
export const shared=()=>null,setShared=()=>{},spaces=()=>[],home=()=>"/scratch",fonts=()=>[],window=()=>({platform:"macos"}),props=()=>state.props,theme=()=>state.theme;
export const run=(...a)=>state.commands.push(a),closeOverlay=id=>state.closed.push(id);
export const readTextFile=async path=>{state.reads.push(path);return state.files[path]??null;};
export const hc=async args=>{state.hcCalls.push(args);return state.hc(args);};
export const exec=async(...args)=>{state.execCalls.push(args);return state.exec(...args);};
`);
const patch=s=>s.replace(/from "(?:gpui-kit|gpui-base|herdr)"/g,'from "../stub.js"');
for(const dir of ["adapters","shared"])for(const n of readdirSync(join(PACK,dir)).filter(n=>n.endsWith(".js")))writeFileSync(join(ROOT,"lib",n),patch(readFileSync(join(PACK,dir,n),"utf8")));
for(const [mod,dir] of [["pdk-guide","guide"]])writeFileSync(join(ROOT,dir,"main.js"),patch(readFileSync(join(PACK,"mods",mod,"main.js"),"utf8")).replaceAll('"./lib/','"../lib/'));
const {state}=await import(join(ROOT,"stub.js"));
const {default:Guide,ROWS}=await import(join(ROOT,"guide/main.js"));
const last=(e,k)=>e.ops.filter(o=>o[0]===k).at(-1)?.[1];
const all=e=>[e,...e.ops.flatMap(o=>o[0]==="child"?[o[1]]:o[0]==="children"?o[1]:[]).filter(c=>c?.ops).flatMap(all)];
const id=(e,k)=>all(e).find(n=>last(n,"id")===k);
const calls=[];const handle={focus(){},is_focused:()=>true};
const cx={focus_handle:()=>handle,notify(){},stop_propagation(){},spawn:fn=>calls.push(Promise.resolve().then(()=>fn(cx))),timer:{after(){},every(_ms,fn){state.poll=fn;}}};
async function drain(){while(calls.length)await Promise.all(calls.splice(0));}
function guide(){const g=new Guide();g.init({},cx);return g;}
beforeEach(()=>{const f=JSON.parse(readFileSync(join(PACK,"themes/pdk-t3-light.json"),"utf8"));Object.assign(state,{theme:{...f,...f.colors},props:{overlay:"one",returnCommand:"pdk-tree.focus:add-machine"},files:{},reads:[],hcCalls:[],execCalls:[],commands:[],closed:[],hc:async()=>({code:0,stdout:'{"machines":[]}'}),exec:async()=>({code:0,stdout:"Linux\n/usr/bin/herdr-core\n"})});});

test("Guide is one short page: what tremor adds, real bindings as kbd, and only Herdr's own routes",()=>{
 expect(ROWS.map(r=>r[0])).toEqual(["Find anything","New workspace","Machines","Chat, Terminal, Factory","Pane hover","Usage","tremor settings","Settings"]);
 state.props={overlay:"guide"};state.closed=[];state.commands=[];
 const r=guide().render();expect(id(r,"guide-next")).toBeUndefined();expect(id(r,"guide-back")).toBeUndefined();
 last(id(r,"guide-keys"),"on_click")({},cx);expect(state.closed.at(-1)).toBe("guide");expect(state.commands.at(-1)).toEqual(["app.help"]);
 last(id(guide().render(),"guide-close"),"on_click")({},cx);expect(state.commands).toEqual([["app.help"]]);
 expect(JSON.stringify(r)).not.toMatch(/pdk-usage\.help|Advanced|page/);
});

// pdk-machine-add is retired (Add machine is Herdr's own machine-add, spec §5 and §8); the guide keeps its scale.
test("The guide keeps the shared scale in all themes",()=>{
 for(const name of readdirSync(join(PACK,"themes")).filter(n=>n.endsWith(".json"))){
  const f=JSON.parse(readFileSync(join(PACK,"themes",name),"utf8"));state.theme={...f,...f.colors};
  const r=guide().render();expect(last(id(r,"guide-head"),"h")).toBe(40);expect(last(id(r,"guide-row-0"),"h")).toBe(40);expect(last(id(r,"guide-close"),"h")).toBe(28);
 }
});
