// Recording renderer for parity behavior. Handlers cannot register inside a virtual-item callback.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as status from "../adapters/status.js";
import * as workspace from "../adapters/workspace.js";
import * as views from "../adapters/views.js";
import { agentKind, kindName } from "../adapters/agents.js";
import { contrast, toHsl, fromHsl, glassGrounds } from "../adapters/tokens.js";
const root = new URL("..", import.meta.url).pathname;
export function evaluate(file, env, expression) {
  let source = readFileSync(join(root, file), "utf8"); const args = new Map();
  source = source.replace(/^import (.+) from ["'][^"']+["'];\s*$/gm, (_line, spec) => {
    if (spec.startsWith("{")) for (const part of spec.slice(1,-1).split(",")) { const [name, alias] = part.trim().split(/\s+as\s+/); args.set(alias || name, env[alias || name] ?? env[name]); }
    else if (spec.startsWith("* as ")) args.set(spec.slice(5), env[spec.slice(5)]);
    else args.set(spec, env[spec]);
    return "";
  }).replace(/export default class /g, "class ").replace(/\bexport (const|function|class) /g, "$1 ");
  return new Function(...args.keys(), source + `\nreturn (${expression});`)(...args.values());
}
export function harness(world, initialProps = {}) {
  // Validate against the committed native API definition, including populated non-default render paths.
  const roles = new Set([...readFileSync(join(root,"mods/pdk-usage/gpui-kit.d.ts"),"utf8").match(/export type Role =([\s\S]*?);/)[1].matchAll(/"([^"]+)"/g)].map((m)=>m[1]));
  const elements = [], calls = [], overlays = [], tasks = [], scrolls = [], store = new Map(), local = new Map();
  let p = initialProps, inItem = false, focus = false;
  const element = (kind = "div") => {
    const node = { kind, props: {}, kids: [] }; elements.push(node); let el;
    el = new Proxy(node, { get(target, method) {
      if (["kind","props","kids"].includes(method)) return target[method];
      return (...args) => {
        if (method === "role" && !roles.has(args[0])) throw new Error(`unknown accessibility role ${args[0]}`);
        if (String(method).startsWith("on_") && inItem) throw new Error("handler registered in item renderer");
        if (method === "when") { if (args[0]) args[1](el); }
        else if (method === "child") { if (args[0] != null) node.kids.push(args[0]); }
        else if (method === "children") node.kids.push(...args[0].filter((x) => x != null));
        else { if (["on_mouse_down","on_mouse_up","on_action"].includes(method)) node.props[`${method}:${args[0]}`] = args[1]; node.props[method] = args.length > 1 ? args : args[0] ?? true; }
        return el;
      };
    } }); return el;
  };
  const handle = () => ({ focus: () => { focus = true; }, is_focused: () => focus });
  const input = (opts) => { let value = opts.value ?? ""; const events = {}; return { events, value: () => value, set_value: (v) => { value = v; }, set_selected_range: () => {}, focus: () => {}, on: (name, fn) => { events[name] = fn; } }; };
  const env = {
    ...status, ...workspace, ...views, View: class {}, div: () => element(), h_flex: () => element("h_flex"), v_flex: () => element("v_flex"), svg: () => element("svg"), image: () => element("image"),
    props: () => p, spaces: () => world.spaces, panes: () => world.panes, terminals: () => world.terminals, agents: () => world.agents,
    machines: () => [{ name: null, layout: "ready" }, ...(world.machines ?? []).map((m) => ({ name: m.name, layout: m.state === "connected" ? "ready" : "unavailable" }))],
    focused: () => world.focused ?? { terminal: world.panes[0]?.terminal },
    theme: () => JSON.parse(readFileSync(join(root,"themes/pdk-t3-light.json"),"utf8")).colors,
    settings: () => ({ zoom: world.zoom ?? 1 }), window: () => ({ platform: "macos", active: false }), fonts: () => [], home: () => "/private-test",
    shared: (key) => store.get(key) ?? null, setShared: (key,value) => store.set(key,value),
    run: (...args) => { calls.push(args); world.onRun?.(...args); }, notify: (n) => calls.push(["notify", n]), pickFolder: async () => world.pick ?? null, openOverlay: (args) => overlays.push(args), closeOverlay: (id) => calls.push(["closeOverlay",id]), keys: () => world.keys ?? [],
    layout: () => ({ id:"work-body", active:world.view ?? "main", children:[] }), setAgentOrder: (order) => calls.push(["order",order]),
    nextCommand: () => (world.next ? world.next() : new Promise(() => {})), hc: async (args) => world.hc ? world.hc(args) : ({ code:0, stdout:'{"machines":[]}',stderr:"" }), exec: async (...args) => world.exec ? world.exec(...args) : ({ code:1, stdout:"", stderr:"not a git repository" }),
    agentKind, kindName, contrast, toHsl, fromHsl, glassGrounds, knownAgents: async (o) => (world.known ? world.known(o) : []), helper: async () => null,
    InputState: { new: input }, Input: { new: () => element("Input") }, Scrollbar: { vertical: () => element("Scrollbar") },
    VirtualListScrollHandle: { new: () => { const h = { scroll_to_item: (at) => scrolls.push([h,at]) }; return h; } },
    ScrollHandle: { new: () => { const h = { kind: "ScrollHandle", scroll_to_item: (at) => scrolls.push([h,at]) }; return h; } },
    v_virtual_list: (id,count,sizes,key,render) => { const el = element("virtual-list").id(id); el.props.virtual = { count,sizes,key,render }; return el; },
    sessions: {}, chipLabel: () => "model",
    localStorage: {getItem:(k)=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)},
    Button: { new: (id) => element("Button").id(id) }, Toggle: { new: (id) => element("Toggle").id(id) }, Popover: { new: (id) => element("Popover").id(id) }, HoverCard: { new: (id) => element("HoverCard").id(id) },
    Progress: { new: (id) => element("Progress").id(id) }, ProgressTrack: { new: () => element("ProgressTrack") }, ProgressIndicator: { new: () => element("ProgressIndicator") }
  };
  // localStorage is a runtime global rather than a module import.
  globalThis.localStorage = env.localStorage;
  const ui = evaluate("shared/ui.js",env,"({TYPE,SPACE,ICON,ROW,RADIUS,withFont,monoFont,kindOf,iconFor,agentLabel,kindMarker,statusMarker,textButton,iconButton,icon,caretButton,focusRing,rowStates,byPointer,pointed,keyed,segmentedChoice,fitLabel,foldMarker,findNode,since,overlayFrame,overlayHeader,actionButton,fieldFrame,button,sidebarRow,menuFrame,menuItem,popover,tooltip,kbd,keyGlyphs,shortcut,progressBar,softInk,fgWash,DISABLED,agentMark,folderLabel,menuState,bindMenuKeys,MENU_KEYS})");
  Object.assign(env,ui,{ROWS:ui.ROW});
  const model = evaluate("mods/pdk-tree/menu-model.js",env,"({captureMenu,validMenu,menuEntries,place})"); Object.assign(env,model);
  const Menu = evaluate("mods/pdk-tree/menu.js",env,"ContextMenu"); env.ContextMenu = Menu;
  env.TreeRowView = evaluate("mods/pdk-tree/row-view.js",env,"TreeRowView");
  env.plusButton = evaluate("shared/plus.js",env,"plusButton");
  Object.assign(env,evaluate("shared/new-workspace.js",env,"({newWorkspace,rememberFolder,plusTarget})"));
  const Tree = evaluate("mods/pdk-tree/main.js",env,"Tree");
  const Tabs = evaluate("mods/pdk-tabs/main.js",env,"Tabs");
  const Worktree = evaluate("mods/pdk-worktree/main.js",env,"Worktree");
  const bindings = [];
  const cx = { bind_keys:(list)=>{bindings.push(...list);return list.length;}, new:(Class,p)=>{const v=new Class();v.init?.(p,cx);return {set_props:(p)=>v.update?.(p),release:()=>true,render:()=>v.render(cx)};},sleep:async()=>{}, spawn:(fn)=>tasks.push(fn), focus_handle:handle, notify:()=>{}, stop_propagation:()=>{}, timer:{ every:()=>{},after:()=>{} } };
  return {env,ui,model,Tree,Menu,Tabs,Worktree,cx,bindings,elements,calls,overlays,tasks,scrolls,store,world,
    props:(v)=>p=v, byId:(id)=>elements.findLast((e)=>e.props.id===id),
    renderItems:(id)=> { const e=elements.findLast((e)=>e.props.id===id); inItem=true;try{return e.props.virtual.render({start:0,end:e.props.virtual.count});}finally{inItem=false;} },
    flushRows:async(tree)=>{const task=tasks.at(-1);await task(cx);tree.render(cx);for(const v of tree.rowViews.values())v.render();},
    clear:()=>{elements.length=0;calls.length=0;scrolls.length=0;}
  };
}
export function world(n=4) {
  const spaces=[{id:"A",name:"Alpha",folder:"/repo/a",machine:null,active:true,tabs:[]},{id:"B",name:"Beta",folder:"/repo/b",machine:null,tabs:[]},{id:"R",name:"Remote",folder:"/remote/repo",machine:"box",tabs:[]}];
  const panes=[],terminals=[],agents=[];
  for(let i=1;i<=n;i++) { const s=i===n?spaces[2]:spaces[0],id=`t${i}`,tab=`tab${i}`;
    s.tabs.push({id:tab,name:`Task ${i}`,active:i===1,settled:false});panes.push({pane:`p${i}`,tab,terminal:id,cwd:s.folder,focused:i===1,program:{agent:true,key:"codex",name:"Codex"}});
    terminals.push({address:id,state:"live",pid:i,status:i===1?"blocked":i===2?"done":"idle",turn:2,records:{},report:{app:"codex",state:"idle"}});agents.push({address:id,status:i===1?"blocked":i===2?"done":"idle",pinned:false,seq:i});
  }
  return {spaces,panes,terminals,agents,machines:[{id:"core-box",name:"box",state:"connected",target:"host",session:"s"}]};
}
