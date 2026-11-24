// Command catalogue cloned from herdr-app@2405bf3 defaults/frame/palette/main.js (Apache-2.0).
// Native names/groups retained, plus explicit pack registry, captured context and resolved scoped hints.
const NAMED = [
  ["tab.new", {}, "Tab", "New tab", "tab agent new task"],
  ["mod.open", { name: "picker" }, "Tab", "Go to space or tab…", "switch jump find"],
  ["tab.rename", {}, "Tab", "Rename tab", "tab"],
  ["tab.close", {}, "Tab", "Close tab", "tab kill"],
  ["tab.next", {}, "Tab", "Next tab", "tab"],
  ["tab.prev", {}, "Tab", "Previous tab", "tab"],
  ["pane.split", { direction: "right" }, "Pane", "Split right", "vertical"],
  ["pane.split", { direction: "down" }, "Pane", "Split down", "horizontal"],
  ["pane.close", {}, "Pane", "Close pane", "kill"],
  ["pane.zoom", {}, "Pane", "Zoom pane", "maximize fullscreen"],
  ...["left", "right", "up", "down"].map((d) => ["pane.go", { direction: d }, "Pane", `Focus pane ${d}`, "move go"]),
  ...["left", "right", "up", "down"].map((d) => ["pane.swap", { direction: d }, "Pane", `Swap pane ${d}`, "move"]),
  ["space.rename", {}, "Space", "Rename space", "workspace"],
  ["space.close", {}, "Space", "Close space", "workspace kill"],
  ["space.next", {}, "Space", "Next space", "workspace"],
  ["space.prev", {}, "Space", "Previous space", "workspace"],
  ["layout.switch", {}, "Layout", "Next layout", "look switch"],
  ["layout.reset", {}, "Layout", "Reset layout", "new version default restore herdr's"],
  ["layout.clone", {}, "Layout", "Duplicate layout", "clone copy customize"],
  ["mod.clone", {}, "Layout", "Duplicate mod", "clone copy customize"],
  ["terminal.open", {}, "Terminal", "New terminal", "shell"],
  ["terminal.copy", {}, "Terminal", "Copy", "clipboard"],
  ["terminal.paste", {}, "Terminal", "Paste", "clipboard"],
  ["agent.next", {}, "Agent", "Next agent", ""],
  ["agent.prev", {}, "Agent", "Previous agent", ""],
  ["window.minimize", {}, "Window", "Minimize window", ""],
  ["window.maximize", {}, "Window", "Maximize window", "restore"],
  ["window.close", {}, "Window", "Close window", "quit"],
  ["app.settings", {}, "App", "Settings", "preferences options config look font theme sound"],
  ["app.help", {}, "App", "Keys", "keybindings shortcuts help"],
  ["app.welcome", {}, "App", "Welcome", "intro start onboarding"],
  ["app.whats_new", {}, "App", "What's new", "release changes news update"],
  ["app.reset", {}, "App", "Reset to the default screen", "escape hatch broken restore"],
  ["app.zoom_in", {}, "App", "Zoom in", "bigger font size"],
  ["app.zoom_out", {}, "App", "Zoom out", "smaller font size"],
  ["app.zoom_reset", {}, "App", "Reset zoom", "font size"],
  ["app.quit", {}, "App", "Quit Herdr", "exit"],
  ...["graphite", "ink", "moss", "atom-one-dark"].map((n) => ["app.theme", { name: n }, "App", `Theme: ${n.replace(/-/g, " ")}`, "colors look"]),
];

// Commands that act on something you point at (ids, terminals): not for a list.
const HIDDEN = new Set([
  "space.move", "tab.move", "space.select", "tab.select", "pane.focus", "terminal.keep",
  "terminal.park", "terminal.kill", "terminal.show", "agent.focus", "layout.set", "layout.toggle",
  "layout.show", "layout.hide", "layout.resize", "layout.select", "mod.open", "overlay.close",
  // Herdr's own pair that hides a tab from its lists stays out of this one (owner, 10 Nov).
  "tab.settle", "tab.unsettle",
  // Herdr's bare space.new makes a workspace named after wherever it starts ("/" on a fresh machine): Cmd+K offers the
  // sidebar's + instead (spec section 8), as the entries at the end of commandRows.
  "space.new",
  "app.palette", "app.hide", "app.hide_others", "app.show_all", "app.theme", "app.settings",
]);

function titleOf(name) {
  const [noun, verb] = name.split(".");
  return { group: noun.charAt(0).toUpperCase() + noun.slice(1), title: `${verb.replace(/_/g, " ")} ${noun}`.replace(/^./, (c) => c.toUpperCase()) };
}


export function resolvedHints(command, bindings, {layout="tremor",terminal=false,mod=null}={}) {
  const rank=s=>s==="global"?0:s===`layout:${layout}`?1:s==="terminal"&&terminal?2:s===`mod:${mod}`&&mod?3:-1;
  const effective=new Map();
  for(const b of bindings){const r=rank(b.section);if(r<0)continue;const old=effective.get(b.keys);if(!old||r>=old.rank)effective.set(b.keys,{...b,rank:r});}
  const values=Object.entries(command.args??{}).filter(([k])=>!["id","space","pane"].includes(k)).map(([,v])=>v),want=values.length===1?`${command.name}:${values[0]}`:command.name;
  return [...effective.values()].filter(b=>b.action===want || b.action===command.name && !values.length).map(b=>`${b.keys} · ${b.section}`).join(" / ");
}
export function captureSearchContext(snapshot) {
 const space=snapshot.spaces.find(s=>s.id===snapshot.focus?.space) ?? snapshot.spaces.find(s=>s.active);
 const tab=space?.tabs.find(t=>t.id===snapshot.focus?.tab) ?? space?.tabs.find(t=>t.active);
 const pane=snapshot.panes.find(p=>p.pane===snapshot.focus?.pane);
 return space?{id:space.id,space:space.id,name:space.name,machine:space.machine??null,folder:pane?.cwd||space.folder,repo:pane?.cwd||space.folder,tab:tab?.id,tabName:tab?.name||tab?.id,paneName:pane?.title||pane?.cwd?.split(/[\\/]/).pop()||"Pane",pane:pane?.pane,terminal:pane?.terminal}:null;
}
export function targetAvailable(target,snapshot,type="space") {
 if(!target)return false;
 if(type==="machine")return target.machine==null||snapshot.machines.some(m=>m.name===target.machine);
 const s=snapshot.spaces.find(s=>s.id===target.space&&(s.machine??null)===(target.machine??null));if(!s)return false;
 if(type==="tab")return s.tabs.some(t=>t.id===target.id);
 if(type==="agent"||type==="pane")return target.terminal?snapshot.terminals.some(t=>t.address===target.terminal && t.state==="live"):snapshot.panes.some(p=>p.pane===target.pane);
 return true;
}
export function commandRows({catalogue,layouts=[],bindings=[],context,snapshot,scope={}}) {
 const known=new Set(catalogue.map(c=>c.name)),named=new Set(NAMED.map(n=>n[0]));
 const entries=NAMED.filter(([n])=>known.has(n)).map(([name,args,group,label,words])=>({name,args,group,label,words}));
 for(const name of layouts)entries.push({name:"layout.switch",args:{name},group:"Layout",label:`Layout: ${name}`,words:"look"});
 for(const c of catalogue){if(named.has(c.name)||HIDDEN.has(c.name)||c.args.some(a=>a.required&&a.name!=="name"))continue;const title=titleOf(c.name);entries.push({name:c.name,args:{},group:title.group,label:title.title,words:c.about});}
 const pack=[
  ["files","Files","Browse files and previews",{name:"mod.open",args:{name:"pdk-files",props:{...context,mode:"browse"}}}],
  ["changes","Changes","Review and commit all changes",{name:"mod.open",args:{name:"pdk-changes",props:{...context,mode:"changes"}}}],
  ["new-agent","New agent…","Choose an installed agent",{name:"mod.open",args:{name:"pdk-new-menu"}}],
  ["machine-add","Add machine","Connect another computer",{name:"mod.open",args:{name:"pdk-machine-add"}}],
  // The one-page guide's way in (spec section 5: "one concise help page via existing palette command").
  ["guide","Guide","What tremor adds and its keys",{name:"mod.open",args:{name:"pdk-guide"}}],
  // tremor's own settings page (owner, 11 Nov): a default folder per machine and the pane hover style.
  ["settings","tremor settings","default folder pane hover",{name:"mod.open",args:{name:"pdk-settings"}}],
  ["places","Places","Find machines, workspaces, tabs, agents and panes",{name:"pdk-search.mode:places"}],
  ["factory","Factory","Factory observer view",{name:"layout.select",args:{stack:"work-body",child:"factory"}}],
  // The pane header's hover controls (owner, 11 Nov): tremor has no settings screen and Herdr's Settings takes no
  // mod's option, so the two styles are picked here; pdk-search sets the shared key (adapters/views.js HOVER_KEY).
  ["hover-clean","Pane hover: Clean","pane header hover style text buttons previous",{name:"pdk-pane.hover",args:{style:"clean"}}],
  ["hover-normal","Pane hover: Normal","pane header hover style icons",{name:"pdk-pane.hover",args:{style:"normal"}}],
 ];
 for(const [id,label,words,command]of pack)entries.push({name:command.name,args:command.args??{},group:"tremor",label,words,pack:id,needsTarget:["files","changes","new-agent"].includes(id)});
 // Native terminal.open has no explicit workspace argument. Use tab.new's captured space, same native launch.
 for(const e of entries){
   if(e.name==="layout.clone")e.args={name:scope.layout??"tremor"};
   if(e.name==="terminal.open") {e.name="tab.new";e.args={space:context?.space};e.needsTarget=true;}
   if(["tab.new","tab.rename","tab.close"].includes(e.name)){e.args={...e.args,...(e.name==="tab.new"?{space:context?.space,folder:context?.folder}:{id:context?.tab})};e.needsTarget=true;}
   if(["space.rename","space.close"].includes(e.name)){e.args={...e.args,id:context?.space};e.needsTarget=true;}
   if(["terminal.copy","terminal.paste","terminal.paste_image","terminal.search","pane.go","pane.swap"].includes(e.name))e.needsTarget=true;
   if(["pane.split","pane.close","pane.zoom"].includes(e.name)){e.args={...e.args,pane:context?.pane};e.needsTarget=true;}
 }
  // New workspace is the sidebar's + (spec section 3): on the machine the filter shows, or on one machine by name.
  entries.push({name:"pdk-tabs.new-workspace",args:{},group:"Space",label:"New workspace",words:"new space workspace"});
  for(const m of [null,...snapshot.machines.filter(m=>m.name&&m.layout!=="unavailable"&&m.layout!=="loading").map(m=>m.name)])entries.push({name:`pdk-tabs.new-workspace:${m||"local"}`,args:{},group:"Space",label:`New workspace · ${m||"This computer"}`,words:"new space workspace machine"});
 return entries.map(e=>{
  e.label=e.label.replace(/\bspace\b/g,"workspace"); if(e.group==="Space")e.group="Workspace";
  const available=(!["files","changes"].includes(e.pack)||Boolean(context?.folder))&&(!e.needsTarget||targetAvailable(context,snapshot) && (!e.name.startsWith("tab.")||e.name==="tab.new"||context?.tab&&snapshot.spaces.some(s=>s.tabs.some(t=>t.id===context.tab))) && (!e.name.startsWith("pane.")||context?.pane&&snapshot.panes.some(p=>p.pane===context.pane)));
  const required=catalogue.find(c=>c.name===e.name)?.args??[],needsName=required.some(a=>a.name==="name"&&a.required)&&e.args.name===undefined||e.name==="mod.clone"; // Rename asks through Herdr's own prompt: no name, the captured id (review UX04)
  const command={name:e.name,args:e.args};
  const label=["tab.close","space.close","tab.rename","space.rename"].includes(e.name)?`${e.label} · ${e.name.startsWith("tab.")?context?.tabName||context?.tab||"No tab":context?.name||"No workspace"}`:e.name==="pane.close"?`${e.label} · ${context?.paneName||context?.pane||"No pane"}`:e.label;
  return {kind:"command",key:`cmd:${e.name}:${JSON.stringify(e.args)}:${e.pack??""}`,label,detail:available?resolvedHints(command,bindings,scope):context?.folder?"Unavailable: no captured target":"Unavailable: no captured folder",group:e.group,hay:`${e.group} ${label} ${e.words||""} ${e.name}`.toLowerCase(),aria:label,what:null,command:available?command:null,needsName,target:e.needsTarget?context:null};
 });
}
// Places mode's Commands group (K4): at most `max` commands matching every word of a non-empty query, label matches
// before matches on other words only, then catalogue order; the Places command itself is left out, and so is a
// command with no target here. Empty query or no match: nothing.
export function placeCommands(rows,query,max=3) {
 const words=query.toLowerCase().split(/\s+/).filter(Boolean);
 if(!words.length)return [];
 const hits=rows.filter(r=>r.command&&r.command.name!=="pdk-search.mode:places"&&words.every(w=>r.hay.includes(w)));
 const inLabel=r=>words.every(w=>r.label.toLowerCase().includes(w));
 const shown=[...hits.filter(inLabel),...hits.filter(r=>!inLabel(r))].slice(0,max);
 return shown.length?[{head:true,key:"hd:commands",label:"Commands",count:shown.length},...shown]:[];
}
export function commandList(rows,query,recent=[]) {
 const words=query.replace(/^>\s*/,"").toLowerCase().split(/\s+/).filter(Boolean),filtered=rows.filter(r=>words.every(w=>r.hay.includes(w)));
 if(words.length)return filtered;
 const first=recent.map(k=>filtered.find(r=>r.key===k)).filter(Boolean).slice(0,5);
 const out=first.length?[{head:true,key:"hd:recent",label:"Recent",count:first.length},...first]:[];
 for(const group of [...new Set(filtered.map(r=>r.group))]){const mine=filtered.filter(r=>r.group===group&&!first.includes(r));if(mine.length)out.push({head:true,key:`hd:${group}`,label:group,count:mine.length},...mine);}
 return out;
}
