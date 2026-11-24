import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PACK = new URL("..", import.meta.url).pathname;
const ROOT = mkdtempSync(join(tmpdir(), "pdk-panel-components-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
mkdirSync(`${ROOT}/lib`);
const stub = `
export const element = kind => {
 const o={kind,ops:[]}; let p;
 p=new Proxy(o,{get(o,k){if(k in o || k==="then" || typeof k==="symbol")return o[k];return (...a)=>{if(k==="when"){if(a[0])a[1](p);return p;}o.ops.push([k,...a]);return p;};}});return p;
};
export class View {}
export const div=()=>element("div"), svg=()=>element("svg"), h_flex=()=>element("h_flex"), v_flex=()=>element("v_flex");
export const Button={new:id=>element("Button").id(id)},Toggle={new:id=>element("Toggle").id(id)},Progress={new:id=>element("Progress").id(id)},ProgressTrack={new:()=>element("ProgressTrack")},ProgressIndicator={new:()=>element("ProgressIndicator")},HoverCard={new:id=>element("HoverCard").id(id)},Popover={new:id=>element("Popover").id(id)},Checkbox={new:id=>element("Checkbox").id(id)};
export const input=options=>({_value:options?.value??"",events:{},value(){return this._value;},set_value(v){this._value=v;},on(e,f){this.events[e]=f;},focus(){this.events.focus?.({},cx);},blur(){this.events.blur?.({},cx);}});
export const InputState={new:input}, Input={new:()=>element("input")};
export const SliderState={new:o=>({_value:o.value,value(){return this._value;},set_value(v){this._value=v;},on(){}})};
export const Slider={new:()=>element("slider")}, SliderTrack=Slider,SliderIndicator=Slider,SliderThumb=Slider;
export const state={shared:{},settings:{theme:"pdk-t3-light"},props:{},spaces:[],panes:[],terminals:[],commands:[]};
export const handle=()=>({focused:false,focus(){this.focused=true;},is_focused(){return this.focused;}});
export const cx={focus_handle:handle,notify(){},spawn(){},timer:{after(){},every(){}}};
export const shared=k=>state.shared[k],setShared=(k,v)=>state.shared[k]=v,settings=()=>state.settings,props=()=>state.props;
export const spaces=()=>state.spaces,panes=()=>state.panes,terminals=()=>state.terminals,agents=()=>[],machines=()=>[];
export const home=()=>"/scratch",appHome=()=>"/scratch/app",fonts=()=>[],window=()=>({platform:"macos"});
export const updates=()=>state.updates;
export const theme=()=>state.theme,run=(...a)=>state.commands.push(a),closeOverlay=()=>{},openOverlay=()=>{};
export const keys=()=>[],commands=()=>[],layouts=()=>[],focused=()=>null;
export const exec=()=>{},nextCommand=()=>{},readTextFile=()=>{},writeTextFile=()=>{};
`;
writeFileSync(`${ROOT}/stub.js`,stub);
const patch=s=>s.replace(/from "(?:gpui-kit|gpui-base|herdr)"/g,'from "../stub.js"');
for(const dir of ["adapters","shared"])for(const n of readdirSync(join(PACK,dir)).filter(n=>n.endsWith(".js"))) writeFileSync(`${ROOT}/lib/${n}`,patch(readFileSync(join(PACK,dir,n),"utf8")));
for(const mod of ["search","files"]){
 mkdirSync(`${ROOT}/${mod}`);
 for(const n of readdirSync(join(PACK,`mods/pdk-${mod}`)).filter(n=>n.endsWith(".js")))writeFileSync(`${ROOT}/${mod}/${n}`,patch(readFileSync(join(PACK,`mods/pdk-${mod}/${n}`),"utf8")).replaceAll('"./lib/','"../lib/'));
}
const {state,cx,element,handle}=await import(`${ROOT}/stub.js`);
const ui=await import(`${ROOT}/lib/ui.js`);
const Search=(await import(`${ROOT}/search/main.js`)).default;
const Files=(await import(`${ROOT}/files/main.js`)).default;
const file=JSON.parse(readFileSync(join(PACK,'themes/pdk-indigo-graphite-dark.json'),'utf8'));
const theme={...file,...file.colors};state.theme=theme;
const last=(e,key)=>e.ops.filter(o=>o[0]===key).at(-1)?.[1];
const children=e=>e.ops.flatMap(o=>o[0]==="child"?[o[1]]:o[0]==="children"?o[1]:[]).filter(o=>o&&typeof o==="object"&&o.ops);
const all=e=>[e,...children(e).flatMap(all)];
const byId=(e,id)=>all(e).find(x=>last(x,'id')===id);
const pseudo=(e,key)=>{const p=element('style');last(e,key)?.(p);return p;};
const frames=e=>all(e).filter(x=>x.ops.some(o=>o[0]==='border_color'&&o[1]===theme.input)&&x.ops.some(o=>o[0]==='bg'&&o[1]===theme.surface));

// The visual contract's palette: the field is the frame's 40 px top row over a bottom edge, not a boxed field.
test("C7/C8/C9 Search field is the palette's top row and roving rows retain selected fill without per-row Tab stops",()=>{
 const view=new Search();view.init({},cx);
 view.list=()=>[{key:'live',label:'Review',aria:'Review pane',command:{name:'pane.focus'},mark:null}];
 const e=view.render();const field=all(e).find(x=>last(x,'h')===ui.ROW.two&&last(x,'border_b')===1);expect(last(field,'border_color')).toBe(theme.border);
 const row=byId(e,'ps-live');expect(last(pseudo(row,'hover'),'bg')).toBe(theme.selected);expect(last(row,'active')).toBeUndefined();expect(last(row,'bg')).toBe(theme.selected);expect(last(row,'tab_index')).toBeUndefined();
 expect(last(row,'aria_selected')).toBe(true);
});

test("C2/C7/C9/C16 Files uses canonical header, after-text caret, roving focus and solid Attach with guarded count",()=>{
 state.props={source:{id:'one',origin:{key:'t1|s:a',gen:0},cwd:'/scratch/project',on:null}};
 const view=new Files();view.init({},cx);view.tree.loaded('',[{name:'folder',dir:true},{name:'one.txt',dir:false}]);
 let root=view.render(cx);expect(last(byId(root,'files-head'),'h')).toBe(ui.ROW.two);expect(last(byId(root,'files-head-title'),'text_size')).toBe(ui.TYPE.lg);
 let attach=byId(root,'files-attach');expect(last(attach,'disabled')).toBe(true);expect(last(attach,'tab_index')).toBeUndefined();expect(last(attach,'hover')).toBeUndefined();
 const folder=byId(root,'file-folder');expect(last(folder,'tab_index')).toBeUndefined();expect(last(folder,'border_color')).toBe(theme.accent);
 const group=children(folder).find(x=>children(x).some(y=>last(y,'id')==='fold-folder'));expect(last(group,'gap')).toBe(ui.SPACE[0]);
 expect(last(byId(root,'file-one.txt'),'bg')).toBe(theme.popover);
 view.tree.pick('one.txt');root=view.render(cx);attach=byId(root,'files-attach');expect(last(attach,'disabled')).toBe(false);expect(last(attach,'bg')).toBe(theme.solid);expect(last(attach,'text_color')).toBe(theme.solid_foreground);
 expect(last(attach,'h')).toBe(ui.ROW.base);expect(last(attach,'px')).toBe(ui.SPACE[3]);
 last(attach,'on_click')({}, {stop_propagation(){},notify(){}});expect(state.commands.at(-1)[0]).toStartWith('pdk-chat.attach:');
});

test("G3 Clear filter uses the rendered Search callback context and restores results",()=>{
 const view=new Search();view.init({},cx);view.query="absent-result";view.input.set_value(view.query);view.list=()=>[];
 const e=view.render(cx);const clear=byId(e,"search-clear");expect(clear).toBeDefined();last(clear,"on_click")({}, {stop_propagation(){},notify(){}});expect(view.query).toBe("");expect(view.input.value()).toBe("");
});

test("RC06 a focused Checkbox owns its keys: one tick per press, Enter on a folder's box ticks it without opening it",()=>{
 // Native order (herdr-app 2405bf3): keydown bubbles from the focused Checkbox to the browser's root handler, then
 // the Checkbox's own activation calls on_change. Tab moved focus to the box, so the browser's handle is not focused.
 const fresh=()=>{state.props={source:{id:'one',origin:{key:'t1|s:a',gen:0},cwd:'/p',on:null}};const v=new Files();v.init({},cx);v.tree.loaded('',[{name:'dir',dir:true},{name:'f.txt',dir:false}]);return v;};
 const press=(v,box,key)=>{v.handle.focused=false;const root=v.render(cx);
  last(root,'on_key_down')({key,keystroke:key},{stop_propagation(){},notify(){}}); // keydown, from the focused box
  last(byId(v.render(cx),`tick-${box}`),'on_change')(true,cx);};          // keyup: the box's own activation
 let v=fresh();expect(v.tree.at).toBe(0);
 press(v,'f.txt','space');expect(v.tree.paths()).toEqual(['/p/f.txt']); // a box that is not the roving row: only it
 v=fresh();press(v,'dir','space');expect(v.tree.paths()).toEqual(['/p/dir']); // the roving row's own box: ticked, not undone
 v=fresh();press(v,'dir','enter');expect(v.tree.paths()).toEqual(['/p/dir']);expect(v.tree.folders.size).toBe(0); // ticks, does not open
 v=fresh();v.handle.focused=true;last(v.render(cx),'on_key_down')({key:'space',keystroke:'space'},{stop_propagation(){},notify(){}});
 expect(v.tree.paths()).toEqual(['/p/dir']); // the browser itself has the keys: Space ticks the roving row
 v=fresh();let closed=0;v.close=()=>closed++;v.handle.focused=false;last(v.render(cx),'on_key_down')({key:'escape',keystroke:'escape'},{stop_propagation(){},notify(){}});
 expect(closed).toBe(1); // Esc still cancels from any control
});

test("G8 Files error band uses foreground prose and the shared right-side needs-you dot",async()=>{
 const {utilityError}=await import(`${ROOT}/lib/workspace-dialog.js`);const e=utilityError(theme,"error-proof","Cannot list this folder");
 expect(last(e,"h")).toBe(ui.ROW.two);expect(all(e).some(el=>last(el,"text_color")===theme.foreground)).toBe(true);
 expect(all(e).some(el=>last(el,"size")===ui.ICON.dot&&last(el,"bg")===theme.blocked)).toBe(true);
});
