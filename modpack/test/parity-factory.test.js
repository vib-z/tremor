import { test, expect } from "bun:test";
import { harness, world } from "./parity-harness.js";
import { buildPaneTree, moveWorkspace, rebuiltMachine, reconnectArgs } from "../adapters/status.js";

// Spec §5: right-click opens Herdr's own menu for a workspace, a tab and a plain pane, its target captured when it
// opens (rename asks through Herdr's prompt, close through its confirm); the pack's menu only for an agent's own
// actions, which Herdr's lacks.
test("G2 right-click: Herdr's own menu for a workspace, a tab and a pane; the pack's only for an agent", async () => {
  const w=world(),h=harness(w);w.panes.push({pane:"pz",tab:"tab1",terminal:"tz",cwd:"/repo/a",focused:false,program:{key:"shell",name:"zsh",shell:true}});w.terminals.push({address:"tz",state:"live",records:{}});
  w.panes.push({pane:"pq",tab:"tab2",terminal:"tq",cwd:"/repo/a",focused:false,program:{agent:true,key:"codex",name:"Codex"}});w.terminals.push({address:"tq",state:"live",pid:9,status:"idle",turn:2,records:{},report:{app:"codex",state:"idle"}});w.agents.push({address:"tq",status:"idle",pinned:false,seq:9});
  const tree=new h.Tree();tree.init({},h.cx);tree.render(h.cx);
  const open=(key)=>{tree.openContext(tree.list.find((r)=>r.key===key));return h.overlays.at(-1);};
  expect(open("sp:A")).toEqual({mod:"menu",kind:"popup",width:200,height:260,props:{tab:"space",target:{id:"A"}}});
  expect(open("tb:tab2")).toEqual({mod:"menu",kind:"popup",width:200,props:{tab:"tab",target:{id:"tab2",space:"A"}}});
  expect(open("pn:pz")).toEqual({mod:"menu",kind:"popup",width:200,props:{tab:"pane",target:{pane:"pz",terminal:"tz"}}});
  // tab2 holds two agents: the second keeps its own row, an agent's, so the pack's menu: pin and unread.
  expect(open("pn:pq")).toMatchObject({mod:"pdk-tree",props:{part:"menu",tab:"agent",target:{terminal:"tq",space:"A"}}});
  const menu=new h.Menu();h.props({part:"menu",tab:"agent",target:{terminal:"tq",space:"A",machine:null},overlay:"own"});menu.initMenu({},h.cx);
  expect(menu.menuList().map((i)=>i.id)).toEqual(["pin","unread"]);
});

test("G2 workspace reorder never crosses a machine (drag in the tree)", () => {
  const w=world();
  expect(moveWorkspace(w.spaces,"A","R")).toBeNull();expect(moveWorkspace(w.spaces,"A","B")).toEqual({id:"A",index:2});
});

test("G4 rebuilt Connect is exact and retry args retain transport, session and temporary identity", () => {
  const w=world(),h=harness(w),m=w.machines[0];m.state="unreachable";m.why='a different core answers there ("new")';
  expect(rebuiltMachine(m)).toBe(true);expect(rebuiltMachine({...m,why:"SSH unreachable"})).toBe(false);expect(rebuiltMachine({...m,state:"needs_login"})).toBe(false);
  const c=h.model.captureMenu("machine",{machine:"box"},w);expect(h.model.menuEntries(c,w).map((i)=>i.id)).toEqual(["new","manage","connect"]);
  // New workspace on that machine is the sidebar's + (spec §3), aimed there.
  expect(h.model.menuEntries(c,w)[0].command).toBe("pdk-tabs.new-workspace:box");
  expect(reconnectArgs({...m,via:true,temporary:true})).toEqual(["machine","add","--via","host","--name","box","--session","s","--temp"]);
  m.target="replacement";expect(h.model.validMenu(c,w)).toBe(false);
});

test("G4 native login opens a local terminal with captured argv, never a password field or focus-derived host", async () => {
  const w=world();w.machines[0].state="needs_login";const h=harness(w,{tab:"machine",target:{machine:"box"},overlay:"own"});h.store.set("pdk.machines.list",w.machines);
  const menu=new h.Menu();menu.initMenu({},h.cx);expect(menu.menuList().some((i)=>i.id==="connect")).toBe(false);
  await menu.menuChoose("login",h.cx);expect(h.calls).toContainEqual(["space.new",{name:"Sign in to box",machine:"",argv:["hc","machine","login","box"]}]);
  expect(h.calls).toContainEqual(["layout.select",{stack:"work-body",child:"main"}]);
});

test("G5 native pin; unread is a guarded one-time lower write", async () => {
  const w=world(7);
  const writes=[];w.hc=async(a)=>{writes.push(a);return {code:0};};const h=harness(w,{tab:"agent",target:{terminal:"t2",space:"A"},overlay:"own"});const menu=new h.Menu();menu.initMenu({},h.cx);
  await menu.menuChoose("pin",h.cx);expect(h.calls).toContainEqual(["terminal.pin",{terminal:"t2",pinned:true}]);
  await menu.menuChoose("unread",h.cx);expect(writes).toEqual([["label","t2","herdr.seen=1"]]);
  w.terminals.find((t)=>t.address==="t2").turn=0;await menu.menuChoose("unread",h.cx);expect(writes.length).toBe(1);
  w.terminals.find((t)=>t.address==="t2").pid=999;await menu.menuChoose("pin",h.cx);expect(menu.menuError).toContain("no longer available");
});

// Owner, 10 Nov: "maybe we dont need put away or settled - remove that stuff". A tab Herdr's own tab.settle hid stays
// reachable as an ordinary row in the tree and the strip; the sidebar has nothing below the machines.
// Spec §2: pdk-tree.machine:<all|local|name> sets the filter; one machine shows its last workspace again, else its
// first; a machine with none hides the work area (never closes it) until All or a shown workspace brings it back.
test("the machine filter command: last workspace per machine, the work area hidden when the machine has none", async () => {
  const w=world(),h=harness(w);const tree=new h.Tree();tree.init({},h.cx);h.tasks.length=0; // init's loops never end
  const run=async()=>{tree.render(h.cx);for(const task of h.tasks.splice(0))await task(h.cx);};
  await run();expect(tree.lastSpace).toEqual({"":"A"});
  tree.setFilter("box");expect(h.store.get("pdk.machine.filter")).toBe("box");expect(h.calls.at(-1)).toEqual(["space.select",{id:"R"}]);
  // Herdr still shows A (the select is the app's to do): box's filter hides the work area; the rows are box's only.
  h.calls.length=0;await run();expect(h.calls).toContainEqual(["layout.hide",{id:"work-body"}]);
  expect(tree.list.filter((r)=>r.type==="space").map((r)=>r.key)).toEqual(["sp:R"]);
  // Asked once, not on every render; with R shown nothing is hidden. This computer's last workspace was A.
  h.calls.length=0;await run();expect(h.calls.filter((c)=>c[0].startsWith("layout."))).toEqual([]);
  w.spaces[0].active=false;w.spaces[2].active=true;h.calls.length=0;await run();expect(h.calls.filter((c)=>c[0]==="layout.hide")).toEqual([]);
  expect(tree.lastSpace).toEqual({"":"A",box:"R"});
  tree.setFilter("local");expect(h.store.get("pdk.machine.filter")).toBe("");expect(h.calls.at(-1)).toEqual(["space.select",{id:"A"}]);
  // All keeps the focus where it is; a machine nobody knows is All.
  h.calls.length=0;tree.setFilter("all");expect(h.calls).toEqual([]);h.store.set("pdk.machine.filter","gone");await run();
  expect(tree.filter).toBe("all");expect(tree.list.filter((r)=>r.type==="space").length).toBe(3);
});

test("G7 a tab Herdr hid from its lists is an ordinary row in the tree and the strip, with no shelf rows", async () => {
  const w=world(),h=harness(w);w.spaces[0].tabs[1].settled=true;
  expect(buildPaneTree(w)[0].tabs.map((t)=>t.id)).toContain("tab2");
  const tree=new h.Tree();tree.init({},h.cx);tree.render(h.cx);await h.flushRows(tree);
  expect(tree.nav.find((r)=>r.key==="tb:tab2")?.type).toBe("tab");
  expect(tree.list.every((r)=>["space","tab","pane","rec"].includes(r.type))).toBe(true);
  tree.activate(tree.nav.find((r)=>r.key==="tb:tab2"),h.cx);expect(h.calls.at(-1)).toEqual(["pane.focus",{pane:"p2"}]);
  h.clear();const tabs=new h.Tabs();tabs.init();tabs.render();expect(h.byId("tab-tab2")).toBeDefined();expect(h.byId("tab-tab1")).toBeDefined();
});

test("G11 60-agent structural keyboard reveal uses stable keys and retained controls own their render pass", async () => {
  const w=world(61),h=harness(w);const tree=new h.Tree();tree.init({},h.cx);tree.render(h.cx);await h.flushRows(tree);
  expect(()=>h.renderItems("pdk-tree-list")).not.toThrow();tree.handle.focus();tree.onKey({key:"end"},h.cx);tree.render(h.cx);
  expect(h.scrolls.at(-1)[0]).toBe(tree.treeScroll);expect(h.scrolls.at(-1)[1]).toBeGreaterThan(50);
  tree.folded.add("sp:A");tree.render(h.cx);tree.focusRow("tb:tab40",h.cx);tree.render(h.cx);expect(tree.folded.has("sp:A")).toBe(false);expect(tree.sel).toBe("tb:tab40");
  const order=h.calls.filter((c)=>c[0]==="order").at(-1)[1];const drawn=tree.nav.filter((r)=>r.type==="tab"&&r.tab.lead).map((r)=>r.tab.lead.address);expect(order).toEqual(drawn);
  const selected=tree.nav.find((r)=>r.type==="tab").key;tree.sel=selected;w.agents[4].pinned=true;tree.render(h.cx);expect(tree.sel).toBe(selected);
});

test("G2 worktree main/stale guard blocks removal before closing any workspace; branch creation stays on captured host", async () => {
  const w=world(),h=harness(w,{space:"A",machine:null,folder:"/repo/a",action:"remove",overlay:"own"});const v=new h.Worktree();v.captured={space:"A",machine:null};v.repo={top:"/repo/a",main:"/repo/a",linked:false};v.busy=false;
  w.spaces[0].machine="box";const captured=new h.Worktree();captured.init({},h.cx);expect(captured.captured.machine).toBeNull();expect(captured.valid()).toBe(false);w.spaces[0].machine=null;h.tasks.length=0;
  v.go(h.cx);expect(h.tasks.length).toBe(0);expect(await v.remove()).toContain("no longer available");expect(h.calls.length).toBe(0);
  v.repo={top:"/linked",main:"/repo/a",linked:true};w.spaces.splice(0,1);expect(await v.remove()).toContain("no longer available");expect(h.calls.length).toBe(0);
  h.props({space:"R",machine:"box",action:"new"});v.captured={space:"R",machine:"box"};v.on="box";v.repo={top:"/remote/repo",main:"/remote/repo",name:"repo",linked:false};v.userHome="/home/remote";v.text="feature/test";
  const asks=[];w.exec=async(cmd,args,opts)=>{asks.push({cmd,args,opts});return {code:args[0]==="show-ref"?1:0,stdout:"",stderr:""};};
  expect(await v.create()).toBe("");expect(asks.at(-1).args).toEqual(["worktree","add","-b","feature/test","/home/remote/.herdr/worktrees/repo/feature-test","HEAD"]);expect(asks.every((r)=>r.opts.on==="box")).toBe(true);
  expect(h.calls.at(-1)).toEqual(["space.new",{folder:"/home/remote/.herdr/worktrees/repo/feature-test",machine:"box",tab:undefined,argv:undefined}]);
});

test("G4 reconnect persists removal receipt, retries add only, and rejects a changed machine before removal", async () => {
  const w=world(),h=harness(w),tree=new h.Tree();tree.init({},h.cx);
  const m={id:"old",name:"box",state:"unreachable",why:'a different core answers there ("new")',target:"transport",via:true,session:"two"};tree.listed=[m];
  const asks=[];let fail=true;w.hc=async(a)=>{asks.push(a);if(a[1]==="ls")return {code:0,stdout:JSON.stringify({machines:[m]})};if(a[1]==="add"&&fail)return {code:1,stderr:"try later"};return {code:0,stdout:"{}"};};
  tree.reconnect("box",h.cx);await h.tasks.at(-1)(h.cx);expect(tree.reconnecting.box).toMatchObject({removed:true,busy:false,error:"try later"});
  fail=false;tree.reconnect("box",h.cx);await h.tasks.at(-1)(h.cx);expect(asks.filter((a)=>a[1]==="rm").length).toBe(1);expect(asks.filter((a)=>a[1]==="add").length).toBe(2);expect(tree.reconnecting.box).toBeUndefined();
  tree.listed=[m];w.hc=async(a)=>({code:0,stdout:JSON.stringify({machines:[{...m,id:"third"}]})});tree.reconnect("box",h.cx);await h.tasks.at(-1)(h.cx);expect(tree.reconnecting.box.error).toContain("Machine changed");expect(tree.reconnecting.box.removed).toBe(false);
});

test("G2 Remove worktree rechecks newly dirty data before closure and retains checkout identity", async () => {
  const w=world();w.spaces[0].folder="/linked";for(const p of w.panes.filter((p)=>p.tab!=="tab4"))p.cwd="/linked";
  const h=harness(w,{space:"A",machine:null,folder:"/linked",action:"remove",overlay:"own"}),v=new h.Worktree();Object.assign(v,{captured:{space:"A",machine:null},repo:{top:"/linked",main:"/main",linked:true},folder:"/linked",on:null,dirty:false,unpushed:[]});
  const asks=[];w.exec=async(_cmd,a)=>{asks.push(a);const out=a.includes("--show-toplevel")?"/linked":a.includes("--git-common-dir")?"/main/.git":a.includes("--absolute-git-dir")?"/main/.git/worktrees/linked":a.includes("status")?" M data.txt":"";return {code:a.includes("--get-regexp")?1:0,stdout:out,stderr:""};};
  expect(await v.remove()).toContain("changed since this opened");expect(h.calls.length).toBe(0);expect(v.dirty).toBe(true);
  expect(await v.remove()).toBe("");expect(h.calls).toEqual([["space.close",{id:"A",confirmed:true}]]);expect(asks.at(-1)).toEqual(["worktree","remove","--force","/linked"]);
  h.calls.length=0;w.panes[0].cwd="/different";expect(await v.remove()).toContain("no longer available");expect(h.calls.length).toBe(0);
});

test("G2 native drag handlers bind stable IDs, preserve fold state and reject cross-host workspace drops", async () => {
  const w=world(),h=harness(w),tree=new h.Tree();tree.init({},h.cx);tree.render(h.cx);await h.flushRows(tree);
  const a=h.byId("sp:A"),b=h.byId("sp:B"),r=h.byId("sp:R");const folds=[...tree.folded];
  a.props["on_mouse_down:left"]({},h.cx);b.props.on_mouse_move({},h.cx);b.props["on_mouse_up:left"]({},h.cx);b.props.on_click({},h.cx);
  expect(h.calls).toContainEqual(["space.move",{id:"A",index:2}]);expect([...tree.folded]).toEqual(folds);
  const count=h.calls.filter((c)=>c[0]==="space.move").length;a.props["on_mouse_down:left"]({},h.cx);r.props.on_mouse_move({},h.cx);r.props["on_mouse_up:left"]({},h.cx);expect(h.calls.filter((c)=>c[0]==="space.move").length).toBe(count);
  h.clear();const tabs=new h.Tabs();tabs.init();tabs.render();const one=h.byId("tab-tab1"),three=h.byId("tab-tab3");
  one.props["on_mouse_down:left"]({click_count:1},h.cx);w.spaces[0].tabs.reverse();three.props["on_mouse_up:left"]({},h.cx);expect(h.calls.at(-1)).toEqual(["tab.move",{id:"tab1",index:1}]);
  one.props["on_mouse_down:right"]({},h.cx);expect(h.overlays.at(-1)).toEqual({mod:"menu",kind:"popup",width:200,props:{tab:"tab",target:{id:"tab1",space:"A"}}});
});

test("G2 populated Open worktree uses native GPUI option roles, main/current labels and bounded shared search", () => {
  const w=world(),h=harness(w,{space:"A",machine:null,folder:"/repo/a",action:"open",overlay:"own"}),v=new h.Worktree();v.init({},h.cx);
  Object.assign(v,{repo:{top:"/repo/a",main:"/repo/a",name:"a",linked:false},folder:"/repo/a",list:[{path:"/repo/a",branch:"main",main:true,at:1},{path:"/linked",branch:"feature",main:false,at:2}],text:"",userHome:"/home/test"});
  expect(()=>v.render()).not.toThrow();expect(h.byId("wt-0").props.role).toBe("list_box_option");expect(h.byId("wt-list").props.role).toBe("list_box");expect(h.byId("wt-0").props.accessibility_label).toContain("main checkout");
  v.text="feature";v.render();expect(v.shown().map((x)=>x.path)).toEqual(["/linked"]);
  expect(h.byId("wt-name-0").props.text_size).toBe(13);
  expect(h.byId("wt-path-0").props.line_height).toBe("12px");
});



test("G11 viewport measures the remaining body at zoom, so End cannot target a row under the fixed footer", () => {
  const w=world();w.zoom=1.5;const h=harness(w),tree=new h.Tree();tree.init({},h.cx);tree.render(h.cx);tree.sel="tb:tab3";
  h.byId("tree-viewport").props.on_size_change({width:384,height:900},h.cx);tree.render(h.cx);
  expect(h.byId("pdk-tree-list").props.h).toBe(600);expect(h.scrolls.at(-1)[0]).toBe(tree.treeScroll);
});

test("G2 a folder-only Remove request never closes the currently focused workspace", async () => {
  const h=harness(world(),{folder:"/linked",machine:null,action:"remove"}),v=new h.Worktree();v.init({},h.cx);v.repo={top:"/linked",main:"/main",linked:true};v.folder="/linked";
  expect(await v.remove()).toContain("workspace menu");v.go(h.cx);expect(h.calls).toEqual([]);v.render();expect(h.byId("worktree-go").props.disabled).toBe(true);
});

// Review UX10 (contract §7): tooltips are three words or fewer. The machine selector's trigger has one, the chosen
// one's whole name (a long one ends in an ellipsis in the trigger); its menu's entries have none.
test("the sidebar's tooltips are three words or fewer; the machine selector's is the chosen one's name", async () => {
  const w=world(),h=harness(w);const tree=new h.Tree();tree.init({},h.cx);h.tasks.length=0;
  tree.render(h.cx);await h.flushRows(tree);
  expect(h.byId("machine-select").props.tooltip).toBe("All machines");
  expect(h.elements.filter((e)=>/^machine-menu-/.test(String(e.props.id??""))&&"tooltip" in e.props)).toEqual([]);
  // The Workspaces + names where it makes the workspace (F3), so it is the one longer tooltip.
  const long=h.elements.filter((e)=>e.props.id!=="space-new").map((e)=>e.props.tooltip).filter((x)=>typeof x==="string"&&x.trim().split(/\s+/).length>3);
  expect(long).toEqual([]);
});

// Owner, 11 Nov: a row says its state by the symbol alone; the word is the symbol's tooltip and stays in the row's
// accessible name. Under All, This computer's workspaces show its glyph alone, as the machine selector does; others keep names.
test("a row's status is its symbol alone, the word its tooltip and in the row's name; This computer is its glyph under All", async () => {
  const w=world(),h=harness(w);const tree=new h.Tree();tree.init({},h.cx);h.tasks.length=0;
  tree.render(h.cx);await h.flushRows(tree);
  // The rows' words (the machine selector's own trigger and menu, which name This computer, left out).
  const sel=new Set(),walk=(e)=>{if(e?.props&&!sel.has(e.props)){sel.add(e.props);for(const k of [...e.kids,e.props.trigger,e.props.content])walk(k);}};
  for(const pop of h.elements.filter((e)=>e.props.id==="machine-menu"))walk(pop);
  const drawn=h.elements.filter((e)=>!sel.has(e.props)).flatMap((e)=>e.kids.filter((k)=>typeof k==="string"));
  for(const word of ["Working","Ready","Done","Needs you","This computer"]) expect(drawn).not.toContain(word);
  const [needs,done,ready]=["tab1","tab2","tab3"].map((id)=>h.byId(`tb:${id}-st`).props);
  expect([needs.tooltip,done.tooltip,ready.tooltip]).toEqual(["Needs you","Done","Ready"]);
  expect(h.byId("tb:tab1").props.accessibility_label).toMatch(/, Needs you/);
  expect(h.byId("tb:tab3").props.accessibility_label).toMatch(/, Ready/);
  // Hovered, a tab row's Close comes in before the symbol, which stays (its tooltip is read under the pointer).
  tree.hovered="tb:tab3";h.elements.length=0;tree.render(h.cx);for(const v of tree.rowViews.values())v.render();
  const kids=h.byId("tb:tab3").kids.map((k)=>k.props?.id);
  expect(kids.slice(-2)).toEqual(["tb:tab3-close","tb:tab3-st"]);
  const host=h.byId("sp:A-host");
  expect(host.props).toMatchObject({tooltip:"This computer",accessibility_label:"This computer",role:"image"});
  expect(host.kids.map((k)=>[k.kind,k.props.size])).toEqual([["svg",14]]);
  expect(h.elements.some((e)=>e.kids.includes("box"))).toBe(true);
});

// Review UX12 (contract, Section + `.plus`): the sidebar's + and the tab bar's + are one treatment: a 24 by 24
// ghost-muted button with the 4 px corner. Its glyph is the 14 px Lucide plus of the shared icon button, centred
// (owner, 11 Nov: the contract's text "+", 22/400 on a 20 line, sat 4.5 px below the box's middle).
test("the sidebar's + and the tab bar's + are the 14 px plus glyph centred in a 24 square", async () => {
  const w=world(),h=harness(w);const tree=new h.Tree();tree.init({},h.cx);h.tasks.length=0;tree.render(h.cx);
  const tabs=new h.Tabs();tabs.init({},h.cx);h.tasks.length=0;tabs.render();
  const look=(id)=>{const e=h.byId(id),p=e.props,g=e.kids[0];return {kind:e.kind,h:p.h,w:p.w,px:p.px,rounded:p.rounded,items_center:p.items_center,justify_center:p.justify_center,kids:e.kids.length,glyph:g?.kind,size:g?.props.size};};
  const want={kind:"Button",h:24,w:24,px:undefined,rounded:4,items_center:true,justify_center:true,kids:1,glyph:"svg",size:14};
  expect(look("space-new")).toEqual(want);
  expect(look("tab-new")).toEqual(want);
});

// Herdr 0.1.15 item 1 (stock tabs/main.js): the tab strip keeps the shown tab in view: on a change of shown tab, and
// again when the strip or a tab up to the shown one changes size.
test("the tab strip scrolls the shown tab into view, as Herdr 0.1.15's stock tab bar does", () => {
  const w=world(8),h=harness(w);const tabs=new h.Tabs();tabs.init({},h.cx);h.tasks.length=0;
  const reveals=()=>h.scrolls.filter(([hd])=>hd===tabs.scroll).map(([,at])=>at);
  const render=()=>{h.elements.length=0;tabs.render();};
  render();expect(reveals()).toEqual([0]);
  render();expect(reveals()).toEqual([0]);                                   // nothing changed: no request
  for(const tb of w.spaces[0].tabs)tb.active=tb.id==="tab6";render();
  expect(reveals()).toEqual([0,5]);
  expect(h.byId("tab-scroll").props.track_scroll).toBe(tabs.scroll);
  h.byId("tab-scroll").props.on_size_change({},h.cx);expect(reveals().at(-1)).toBe(5);
  expect("on_size_change" in h.byId("tab-tab3").props).toBe(true);            // a tab before the shown one
  expect("on_size_change" in h.byId("tab-tab7").props).toBe(false);           // one after it can't push it out
});

// Herdr 0.1.15 item 2: the tree asks git as stock's spaces mod does: the two rev-parse reads together, then, in a
// repo, symbolic-ref and rev-list together; never git status.
test("the tree's git reads are 0.1.15's ref-only reads, in parallel pairs, on the workspace's machine", async () => {
  const w=world(),h=harness(w);const asked=[];let inFlight=0,most=0;
  w.exec=async(cmd,args,opts)=>{asked.push([cmd,args.join(" "),opts.on??null]);inFlight++;most=Math.max(most,inFlight);await Promise.resolve();inFlight--;
    const a=args.join(" ");
    if(a.includes("--show-toplevel"))return {code:0,stdout:`${opts.cwd}\n`,stderr:""};
    if(a.includes("--git-common-dir"))return {code:0,stdout:`${opts.cwd}/.git\n`,stderr:""};
    if(a.startsWith("symbolic-ref"))return {code:0,stdout:"refs/heads/main\n",stderr:""};
    return {code:0,stdout:"3\t0\n",stderr:""};};
  const tree=new h.Tree();tree.init({},h.cx);h.tasks.length=0;
  tree.render(h.cx);for(const t of h.tasks.splice(0))await t(h.cx);
  expect(asked.some(([,a])=>a.includes("status"))).toBe(false);
  expect([...new Set(asked.map(([,a])=>a))]).toEqual(["rev-parse --path-format=absolute --show-toplevel","rev-parse --path-format=absolute --git-common-dir","symbolic-ref -q HEAD","rev-list --left-right --count HEAD...@{upstream}"]);
  expect(most).toBe(2);
  expect(asked.filter(([,,on])=>on==="box").length).toBe(4);                          // the remote workspace, asked there
  expect(tree.gitOf(w.spaces[0])).toEqual({branch:"main",ahead:3,behind:0});
});

// T3: the agent context menu holds the keyboard on its frame, under PdkMenu; Esc, Tab and Shift-Tab close it and give
// the row its focus back; Enter is the item's Button.
test("context menu keys: the frame tracks the menu's handle under PdkMenu; Esc, Tab, Shift-Tab close back to the row; Enter picks", () => {
  const w=world(),h=harness(w,{part:"menu",tab:"agent",target:{terminal:"t1",space:"A",machine:null},overlay:"own",returnCommand:"pdk-tree.focus:pn:p1"});
  const menu=new h.Menu();menu.initMenu({},h.cx);
  expect(h.bindings.filter((b)=>b.context==="PdkMenu").map((b)=>b.keystroke)).toEqual(["up","down","home","end","tab","shift-tab","escape"]);
  const draw=()=>{h.elements.length=0;menu.renderMenu();return h.byId("pdk-context-menu");};
  const frame=draw();
  expect([frame.props.key_context,frame.props.track_focus]).toEqual(["PdkMenu",menu.menuHandle]);
  expect(h.byId("pdk-context-menu-keys").props.track_focus).toBeUndefined();
  for(const k of ["escape","tab","shift-tab"]){h.calls.length=0;draw().props[`on_action:pdk_menu_${k.replace("-","_")}`]({},h.cx);expect(h.calls).toEqual([["closeOverlay","own"],["pdk-tree.focus:pn:p1"]]);}
  h.calls.length=0;draw().props["on_action:pdk_menu_down"]({},h.cx);
  expect([...h.env.menuState(menu,"pdk-context-menu").handles.keys()]).toEqual(["context-pin","context-unread"]);
  h.calls.length=0;draw();h.byId("context-pin").props.on_click({},{stop_propagation(){}});
  expect(h.calls.some((c)=>c[0]==="terminal.pin")).toBe(true);
});
