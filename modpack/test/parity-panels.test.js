import {test,expect,afterAll} from 'bun:test';
import {readFileSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {captureWorkspace,workspaceCurrent,utilityKey,READ} from '../adapters/workspace.js';
import {commandRows,commandList,resolvedHints,targetAvailable,captureSearchContext} from '../adapters/search-commands.js';
import {placeList,searchRows} from '../adapters/search.js';
import {nativeMenu} from '../adapters/status.js';
const P=new URL('..',import.meta.url).pathname,R=`/tmp/pdk-parity-test-${process.pid}`;mkdirSync(R,{recursive:true});afterAll(()=>rmSync(R,{recursive:true,force:true}));
const world=()=>({spaces:[{id:'A',name:'Alpha',machine:null,folder:R,tabs:[{id:'A1',name:'Lead',active:true},{id:'A2',name:'Earlier',settled:true}]},{id:'B',name:'Beta',machine:'box',folder:'/other',tabs:[]}],panes:[{pane:'p1',tab:'A1',terminal:'t1',cwd:R}],terminals:[{address:'t1',state:'live'}],agents:[],machines:[{name:'box',layout:'ready'}],focus:{space:'A',tab:'A1',pane:'p1'}});
const context={space:'A',name:'Alpha',machine:null,folder:R,repo:R,tab:'A1',pane:'p1',terminal:'t1'};
const catalogue=['tab.new','tab.close','space.new','space.close','space.rename','pane.split','terminal.open','app.reset','app.palette','mod.clone'].map(name=>({name,args:[],about:name}));
test('workspace utility captures paths and host, refuses missing/replaced target, and never follows selection',()=>{
 const p=captureWorkspace(context),w=world();expect(p).toEqual({...context,tab:undefined,pane:undefined,terminal:undefined,trigger:undefined,returnCommand:undefined});
 expect(workspaceCurrent(p,w.spaces)).toBe(true);w.spaces[0].active=false;w.spaces[1].active=true;expect(workspaceCurrent(p,w.spaces)).toBe(true);
 expect(p.folder).toBe(R);expect(workspaceCurrent(p,[{...w.spaces[0],machine:'box'}])).toBe(false);expect(captureWorkspace({folder:R})).toBeNull();expect(captureWorkspace({...context,folder:'bad\npath'})).toBeNull();expect(utilityKey(p)).not.toBe(utilityKey({...p,machine:'box'}));
});
// Spec section 5: the one-page guide is reached through one palette command, "Guide", that opens pdk-guide.
test('Cmd+K has one Guide command that opens the guide, found by typing guide',()=>{
 const rows=commandRows({catalogue,layouts:['main','tremor'],context,snapshot:world()});
 const guide=rows.filter(r=>r.label==='Guide');expect(guide).toHaveLength(1);
 expect(guide[0].command).toEqual({name:'mod.open',args:{name:'pdk-guide'}});
 expect(commandList(rows,'> guide').some(r=>r.label==='Guide')).toBe(true);
});
// Spec section 8: Cmd+K never offers Herdr's bare space.new (how a workspace called "/" comes back); its New workspace
// entries are the sidebar's + for the filter's machine or for one machine.
test('Cmd+K New workspace runs the sidebar\'s +; no entry calls space.new',()=>{
 const rows=commandRows({catalogue,layouts:['main','tremor'],context,snapshot:world()});
 expect(rows.filter(r=>r.command?.name==='space.new')).toEqual([]);
 expect(rows.find(r=>r.label==='New workspace').command).toEqual({name:'pdk-tabs.new-workspace',args:{}});
 expect(rows.find(r=>r.label==='New workspace · This computer').command).toEqual({name:'pdk-tabs.new-workspace:local',args:{}});
 expect(rows.filter(r=>r.label.startsWith('New workspace')).map(r=>r.command.name)).toEqual(['pdk-tabs.new-workspace','pdk-tabs.new-workspace:local','pdk-tabs.new-workspace:box']);
 expect(commandList(rows,'> new space').some(r=>r.label==='New workspace')).toBe(true);
});
// Review UX04: Cmd+K Rename workspace / Rename tab run Herdr's own space.rename / tab.rename with the captured id and no
// name, so Herdr's prompt asks; never the pdk-command-form clone.
test('Cmd+K Rename runs Herdr\'s own rename with the captured id and no name',()=>{
 const rows=commandRows({catalogue:[...catalogue,{name:'tab.rename',args:[],about:'tab.rename'}],layouts:[],context,snapshot:world()});
 const calls=[],v=view('pdk-search',{run:(...a)=>calls.push(a),openOverlay:spec=>calls.push(['overlay',spec]),targetAvailable,store:new Map(),MACHINE_KEYS:{filter:'pdk.machine.filter'}});
 v.snapshot=()=>world();v.close=()=>{};v.choice={missing:false};v.recent=[];
 for(const [label,cmd,args] of [['Rename workspace · Alpha','space.rename',{id:'A'}],['Rename tab · A1','tab.rename',{id:'A1'}]]){
  const row=rows.find(r=>r.label===label);expect(row.needsName,label).toBe(false);
  calls.length=0;v.selected=()=>row;v.go();expect(calls).toEqual([[cmd,args]]);
 }
});
// Reviews UX01 and UX09 through the palette's own dispatch (pdk-search go()): no entry emits space.new, the New
// workspace entries run the tab bar's +, and Guide opens pdk-guide.
test('Cmd+K dispatch: no entry runs space.new; New workspace runs the +; Guide opens the guide',()=>{
 const rows=commandRows({catalogue:[...catalogue,{name:'tab.rename',args:[],about:'tab.rename'}],layouts:['main','tremor'],context,snapshot:world()});
 const calls=[],v=view('pdk-search',{run:(...a)=>calls.push(a),openOverlay:spec=>calls.push(['overlay',spec]),targetAvailable,store:new Map(),MACHINE_KEYS:{filter:'pdk.machine.filter'}});
 v.snapshot=()=>world();v.close=()=>{};v.choice={missing:false};v.recent=[];
 const go=(row)=>{calls.length=0;v.selected=()=>row;v.go();return calls.slice();};
 const all=rows.filter(r=>r.command&&!r.command.name.startsWith('pdk-search.')).flatMap(go); // the palette's own mode switch needs its field
 expect(all.length).toBeGreaterThan(10);
 expect(all.filter(c=>c[0]==='space.new')).toEqual([]);
 expect(go(rows.find(r=>r.label==='New workspace'))).toEqual([['pdk-tabs.new-workspace',{}]]);
 expect(go(rows.find(r=>r.label==='New workspace · box'))).toEqual([['pdk-tabs.new-workspace:box',{}]]);
 expect(go(rows.find(r=>r.label==='New workspace · This computer'))).toEqual([['pdk-tabs.new-workspace:local',{}]]);
 expect(go(commandList(rows,'> guide').find(r=>r.label==='Guide'))).toEqual([['mod.open',{name:'pdk-guide'}]]);
});
// The pane header's two hover styles are picked in Cmd+K's tremor group (owner, 11 Nov): each entry sets the shared
// key the header reads, runs no app command and closes the palette.
test('Cmd+K Pane hover: Clean and Pane hover: Normal set pdk.pane.hover',()=>{
 const rows=commandRows({catalogue,layouts:['main','tremor'],context,snapshot:world()});
 const hover=rows.filter(r=>r.label.startsWith('Pane hover'));
 expect(hover.map(r=>[r.label,r.group])).toEqual([['Pane hover: Clean','tremor'],['Pane hover: Normal','tremor']]);
 const calls=[],store=new Map(),v=view('pdk-search',{run:(...a)=>calls.push(a),openOverlay(){},targetAvailable,store,MACHINE_KEYS:{filter:'pdk.machine.filter'}});
 let closed=0;v.snapshot=()=>world();v.close=()=>{closed++;};v.choice={missing:false};v.recent=[];
 for(const [label,style] of [['Pane hover: Normal','normal'],['Pane hover: Clean','clean']]){v.selected=()=>commandList(rows,'> pane hover').find(r=>r.label===label);v.go();expect(store.get('pdk.pane.hover')).toBe(style);}
 expect([calls,closed]).toEqual([[],2]);
});
test('catalogue includes explicit pack routes, captured native destructive IDs, host New and unchanged recovery',()=>{
 const rows=commandRows({catalogue,layouts:['main','tremor'],context,snapshot:world()});
 expect(rows.find(r=>r.label==='Files').command.args.props).toMatchObject({...context,mode:'browse'});
 expect(rows.find(r=>r.label==='Changes').command.args.props.repo).toBe(R);
 expect(rows.find(r=>r.label.startsWith('Close tab')).command.args).toEqual({id:'A1'});
 expect(rows.find(r=>r.label.startsWith('Close workspace')).command.args).toEqual({id:'A'});
 expect(rows.find(r=>r.label==='New workspace · box').command).toEqual({name:'pdk-tabs.new-workspace:box',args:{}});
 expect(rows.find(r=>r.command?.name==='app.reset')).toBeDefined();expect(rows.find(r=>r.label==='New agent…').target).toEqual(context);
 const stale=commandRows({catalogue,context,snapshot:{...world(),spaces:[]}});expect(stale.find(r=>r.label==='Files').command).toBeNull();expect(stale.find(r=>r.label==='Files').detail).toContain('Unavailable');
 expect(commandList(rows,'> changes').some(r=>r.label==='Changes')).toBe(true);expect(commandList(rows,'', [rows[0].key])[0].label).toBe('Recent');
});
test('actual key hints honour layout and terminal shadows, custom bindings and parameter values',()=>{
 const keys=[{section:'global',keys:'cmd-p',action:'mod.open:picker'},{section:'layout:tremor',keys:'cmd-p',action:'mod.open:pdk-search'},{section:'global',keys:'cmd-r',action:'space.rename'},{section:'terminal',keys:'cmd-r',action:'terminal'},{section:'global',keys:'ctrl-x',action:'space.rename'},{section:'layout:other',keys:'q',action:'space.rename'}];
 expect(resolvedHints({name:'mod.open',args:{name:'picker'}},keys)).toBe('');expect(resolvedHints({name:'mod.open',args:{name:'pdk-search'}},keys)).toBe('cmd-p · layout:tremor');
 expect(resolvedHints({name:'space.rename',args:{id:'A'}},keys,{terminal:true})).toBe('ctrl-x · global');
});
test('Places retains quiet earlier tabs and target identities; a hidden-running tab is a plain tab row',()=>{
 const w=world(),rows=searchRows(w);const quiet=placeList(rows,'',false,w);expect(quiet.some(r=>r.kind==='earlier')).toBe(true);expect(quiet.some(r=>r.kind==='tab')).toBe(false);
 expect(placeList(rows,'',true,w).some(r=>r.kind==='tab')).toBe(true);
 const saved=rows.find(r=>r.kind==='tab'&&r.target.id==='A2');expect(saved.target).toMatchObject({id:'A2',space:'A',machine:null});expect(saved.command.name).toBe('tab.select');expect(quiet.some(r=>r.kind==='put-away')).toBe(false);
 expect(rows.find(r=>r.key==='sp:A').target.space).toBe('A');expect(rows.find(r=>r.key==='mc:box').hidden).toBeUndefined();
 expect(targetAvailable(saved.target,w,'tab')).toBe(true);w.spaces[0].tabs=[];expect(targetAvailable(saved.target,w,'tab')).toBe(false);
 expect(captureSearchContext(world()).folder).toBe(R);
});
// Execute the stock-derived view's real methods against scratch repositories, with only its renderer mocked.
function view(name,env={}){
 let src=readFileSync(`${P}/mods/${name}/main.js`,'utf8').replace(/^import .*;\n/gm,'').replace('export default class','class');const cls=src.match(/class (\w+) extends View/)[1];
 const deps={ICON:{compact:14,dot:7},HOVER_KEY:'pdk.pane.hover',...env,View:class{},captureWorkspace,workspaceCurrent,utilityKey,READ,props:()=>env.p,spaces:()=>env.spaces,shared:k=>env.store.get(k),setShared:(k,v)=>env.store.set(k,v),watchFolder:async()=>{throw Error('watch ended');},theme:()=>({}),InputState:{new:()=>({value:()=>'',on(){},set_value(){}})},EditorState:{new:x=>({...x,release(){}})},monoFont:()=> 'Menlo',TYPE:{sm:12},SPACE:{3:12,5:20}};
 return new (new Function(...Object.keys(deps),`${src}\nreturn ${cls}`)(...Object.values(deps)))();
}
function cx(){const tasks=[];return {tasks,focus_handle:()=>({focus(){}}),notify(){},timer:{every(){}},spawn(fn){const p=fn(this);if(!fn.toString().includes('nextCommand'))tasks.push(p);},async drain(){for(let i=0;i<10&&tasks.length;i++)await Promise.all(tasks.splice(0));}};}
const git=(root,args)=>{const r=Bun.spawnSync(['git','-c','user.name=pdk','-c','user.email=pdk@example.invalid','-c','commit.gpgsign=false',...args],{cwd:root});if(r.exitCode)throw Error(r.stderr.toString());return r.stdout.toString();};
const setup=folder=>{const root=`${R}/${folder}`;mkdirSync(root);git(root,['init','-q']);writeFileSync(`${root}/tracked.txt`,'before\n');git(root,['add','.']);git(root,['commit','-qm','base']);writeFileSync(`${root}/tracked.txt`,'after\n');writeFileSync(`${root}/new.txt`,'untracked\n');return root;};
function changesEnv(root){const e={p:{...context,folder:root,repo:root},spaces:world().spaces,store:new Map(),calls:[],nextCommand:()=>new Promise(()=>{}),readTextFile:async path=>readFileSync(path,'utf8')};e.exec=async(name,args,opts)=>{e.calls.push({name,args,opts});const r=Bun.spawnSync([name,...(name==='git'?['-c','user.name=pdk','-c','user.email=pdk@example.invalid','-c','commit.gpgsign=false']:[]),...args],{cwd:opts.cwd});return {code:r.exitCode,stdout:r.stdout.toString(),stderr:r.stderr.toString()};};return e;}
test('stock Changes reads without optional locks and commits ALL tracked and untracked files only in captured repo',async()=>{
 const root=setup('all-files'),e=changesEnv(root),v=view('pdk-changes',e),c=cx();v.init(null,c);await c.drain();expect(v.files.map(f=>f.path).sort()).toEqual(['new.txt','tracked.txt']);expect(v.rows.length).toBeGreaterThan(0);
 expect(e.calls.filter(c=>c.args.includes('status'))[0].args).toContain('--no-optional-locks');v.message='All sandbox changes';v.commit(c);await c.drain();expect(git(root,['status','--porcelain'])).toBe('');expect(git(root,['log','-1','--pretty=%s']).trim()).toBe('All sandbox changes');expect(e.calls.every(c=>realpathSync(c.opts.cwd)===realpathSync(root))).toBe(true);
});
test('stock Changes keeps message and rejects stale async results / commit before writes',async()=>{
 const root=setup('stale'),e=changesEnv(root),v=view('pdk-changes',e),c=cx();e.store.set(`pdk.changes.message:${utilityKey(e.p)}`,'Keep this draft');v.init(null,c);await c.drain();expect(v.message).toBe('Keep this draft');
 e.spaces=[];const n=e.calls.length;v.commit(c);await c.drain();expect(e.calls).toHaveLength(n);expect(git(root,['status','--porcelain'])).toContain('tracked.txt');
 const e2=changesEnv(root),orig=e2.exec;e2.exec=async(...args)=>{const r=await orig(...args);e2.spaces=[];return r;};const v2=view('pdk-changes',e2),c2=cx();v2.init(null,c2);await c2.drain();expect(v2.files).toEqual([]);
});
test('Changes commit failure retains message, conflicts disable writes, and initial/untracked binary has a reason',async()=>{
 const root=setup('failure'),e=changesEnv(root),v=view('pdk-changes',e),c=cx();v.init(null,c);await c.drain();v.message='Retain me';v.files[0].conflict=true;let n=e.calls.length;v.commit(c);await c.drain();expect(e.calls).toHaveLength(n);v.files[0].conflict=false;
 e.exec=async()=>({code:1,stdout:'',stderr:'failed hook'}); // recompile so the view uses this injected executor
 const failed=view('pdk-changes',e);Object.assign(failed,v);failed.commit(c);await c.drain();expect(failed.message).toBe('Retain me');expect(failed.note).toContain('Commit failed');
 const fresh=`${R}/initial`;mkdirSync(fresh);git(fresh,['init','-q']);writeFileSync(`${fresh}/binary.dat`,'a\0b');const e2=changesEnv(fresh),v2=view('pdk-changes',e2),c2=cx();v2.init(null,c2);await c2.drain();expect(v2.rows[0].text).toContain('Binary file');
});
test('Files clone keeps stock POSIX and Windows listing, bounded readonly preview, stale guard and separate attach mode',async()=>{
 const src=readFileSync(`${P}/mods/pdk-workspace-files/main.js`,'utf8');expect(src).toContain('powershell');expect(src).toContain('cannot start sh: program not found');expect(src).toContain('400000');expect(src).toContain('readonly: true');
 const root=setup('preview'),e={p:{...context,folder:root},spaces:world().spaces,store:new Map(),nextCommand:()=>new Promise(()=>{}),readTextFile:async()=> 'a\0b'};const v=view('pdk-workspace-files',e),c=cx();Object.assign(v,{target:captureWorkspace(e.p),root,on:null,context:{key:utilityKey(e.p)},code:null});v.show('binary.dat',c);await c.drain();expect(v.fileError).toContain('Binary');
 v.fileError=null;e.spaces=[];v.show('elsewhere',c);await c.drain();expect(v.fileError).toBeNull();
 expect(readFileSync(`${P}/mods/pdk-files/main.js`,'utf8')).toContain('props()?.mode==="browse"');
});
test('selected-result Actions and native close use captured IDs and refuse a stale menu target',()=>{
 const w=world(),calls=[],v=view('pdk-search',{run:(...args)=>calls.push(args),openOverlay:spec=>calls.push(["overlay",spec]),setShared(){},targetAvailable,nativeMenu});let row={kind:'workspace',key:'sp:A',target:{id:'A',space:'A',machine:null,name:'Alpha',folder:R},command:{name:'space.select',args:{id:'A'}}};
 v.snapshot=()=>w;v.selected=()=>row;v.close=()=>{};v.choice={missing:false};v.actions({notify(){}});expect(calls.pop()).toEqual(['overlay',{mod:'menu',kind:'popup',width:200,height:260,props:{tab:'space',target:{id:'A'}}}]); // Herdr's own menu (spec §5)
 w.spaces=[];v.actions({notify(){}});expect(calls).toHaveLength(0);expect(v.choice.missing).toBe(true);
 w.spaces=world().spaces;row={kind:'tab',key:'tb:A2',target:{id:'A2',space:'A',machine:null},command:{name:'tab.select',args:{id:'A2'}}};v.closeTab();expect(calls).toEqual([['tab.close',{id:'A2'}]]);
});
test('a destination on another machine moves the machine filter there; All stays All (spec §2)',()=>{
 const w=world(),calls=[],store=new Map([['pdk.machine.filter','box']]);
 const v=view('pdk-search',{run:(...a)=>calls.push(a),openOverlay(){},targetAvailable,store,MACHINE_KEYS:{filter:'pdk.machine.filter'}});
 const row={kind:'workspace',key:'sp:A',target:{id:'A',space:'A',machine:null,name:'Alpha',folder:R},command:{name:'space.select',args:{id:'A'}}};
 v.snapshot=()=>w;v.selected=()=>row;v.close=()=>{};v.choice={missing:false};v.go();
 expect(calls).toEqual([['space.select',{id:'A'}]]);expect(store.get('pdk.machine.filter')).toBe('');
 store.set('pdk.machine.filter','all');v.go();expect(store.get('pdk.machine.filter')).toBe('all');
});
test('commit revalidates the workspace between add-all and commit; no next target is substituted',async()=>{
 const root=setup('mid-commit'),e=changesEnv(root),v=view('pdk-changes',e),c=cx();v.init(null,c);await c.drain();v.message='Do not retarget';const old=e.exec;
 const late=changesEnv(root);late.exec=async(name,args,opts)=>{const r=await old(name,args,opts);if(args[0]==='add')late.spaces=[];return r;};const guarded=view('pdk-changes',late);Object.assign(guarded,v);guarded.commit(c);await c.drain();expect(git(root,['log','-1','--pretty=%s']).trim()).toBe('base');expect(guarded.error).toContain('workspace is no longer available');expect(guarded.message).toBe('Do not retarget');
});
test('native diff and error line heights use explicit pixel lengths; numeric GPUI line heights are multipliers',()=>{
 const changes=readFileSync(`${P}/mods/pdk-changes/main.js`,'utf8'),shell=readFileSync(`${P}/shared/workspace-dialog.js`,'utf8');
 expect(changes).toContain('.line_height(`${SPACE[5]}px`)');expect(shell).toContain('.line_height(`${SPACE[4]}px`)');expect(changes+shell).not.toMatch(/line_height\(SPACE\[/);
});
// Safety pass (safety-parity brief): the commit re-checks before its first write.
test('safety-parity: no configured Git name and email refuses before anything is staged (git would invent one)',async()=>{
 const root=setup('no-identity'),e=changesEnv(root),H=`${R}/no-identity-home`;mkdirSync(H);
 e.exec=async(name,args,opts)=>{e.calls.push({name,args,opts});const r=Bun.spawnSync([name,...args],{cwd:opts.cwd,env:{HOME:H,PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1'}});return {code:r.exitCode,stdout:r.stdout.toString(),stderr:r.stderr.toString()};};
 const v=view('pdk-changes',e),c=cx();v.init(null,c);await c.drain();expect(v.files).toHaveLength(2);v.message='No identity';v.commit(c);await c.drain();
 expect(v.note).toContain('no name and email');expect(v.message).toBe('No identity');expect(e.calls.some(c=>c.args.includes('add'))).toBe(false);
 expect(git(root,['diff','--cached','--name-only'])).toBe('');expect(git(root,['log','-1','--pretty=%s']).trim()).toBe('base');
});
test('safety-parity: a file that appeared after the list was read stops the commit; the next one commits what is shown',async()=>{
 const root=setup('late'),e=changesEnv(root),v=view('pdk-changes',e),c=cx();v.init(null,c);await c.drain();v.message='Only what I saw';
 writeFileSync(`${root}/late.txt`,'appeared\n');v.commit(c);await c.drain();
 expect(v.note).toContain('repository changed');expect(git(root,['diff','--cached','--name-only'])).toBe('');expect(git(root,['log','-1','--pretty=%s']).trim()).toBe('base');
 expect(v.files.map(f=>f.path).sort()).toEqual(['late.txt','new.txt','tracked.txt']);
 v.commit(c);await c.drain();expect(git(root,['status','--porcelain'])).toBe('');expect(git(root,['log','-1','--pretty=%s']).trim()).toBe('Only what I saw');
});
test('safety-parity: a captured repository whose .git went never commits into the repository that holds its folder',async()=>{
 const outer=setup('outer'),inner=`${outer}/inner`;mkdirSync(inner);git(inner,['init','-q']);writeFileSync(`${inner}/a.txt`,'a\n');
 const e=changesEnv(inner),v=view('pdk-changes',e),c=cx();v.init(null,c);await c.drain();expect(realpathSync(v.root)).toBe(realpathSync(inner));
 rmSync(`${inner}/.git`,{recursive:true});v.message='Not the parent';v.commit(c);await c.drain();
 expect(v.note).toContain('repository changed');expect(git(outer,['diff','--cached','--name-only'])).toBe('');expect(git(outer,['log','-1','--pretty=%s']).trim()).toBe('base');
});
