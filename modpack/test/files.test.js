import { test, expect, afterAll } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Drafts, boundedAttachments, filesResult } from "../adapters/composer.js";
const PACK = new URL("..", import.meta.url).pathname;
const ROOT = `/tmp/pdk-files-${process.pid}`;
mkdirSync(`${ROOT}/lib`, { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
cpSync(join(PACK,"adapters/composer.js"),`${ROOT}/lib/composer.js`);
cpSync(join(PACK,"mods/pdk-files/model.js"),`${ROOT}/model.js`);
const { FileTree, parseDirectory, LIST_SCRIPT, SHOWN } = await import(`${ROOT}/model.js`);
const CHAT = readFileSync(join(PACK,"mods/pdk-chat/main.js"),"utf8");
const FILES = readFileSync(join(PACK,"mods/pdk-files/main.js"),"utf8");
function method(src, name, next, deps = {}) {
  // Up to the next method, less any comment lines that belong to that next method.
  const part = src.slice(src.indexOf(`  ${name}(`), src.indexOf(`\n  ${next}(`,src.indexOf(`  ${name}(`))).replace(/(\n\s*\/\/[^\n]*)+\s*$/, "").trim();
  return new Function(...Object.keys(deps),`return ({ ${part} }).${name}`)(...Object.values(deps));
}
const sendFiles = method(CHAT,"receiveFiles","openTerminal",{ terminals:()=>currentTerms, filesResult });
let currentTerms = [{address:"box/t1",foreground:{pid:10}}];
const source = origin => ({id:"request-one",origin,on:"box",cwd:"/project",address:"box/t1",pid:10});
function deliver(drafts, request, paths, extra={}) {
  const view = { drafts, fileRequests:new Map([[request.id,request]]), syncDraft:()=>{} };
  sendFiles.call(view,JSON.stringify({ id:request.id,origin:request.origin,on:request.on,paths,...extra }),{notify:()=>{}});
  return view;
}

test("the clone retains exactly one fixed listing exec, with argument path and remote on", () => {
  const files = [FILES,readFileSync(join(PACK,"mods/pdk-files/model.js"),"utf8")].join("\n");
  expect([...files.matchAll(/\b(exec|hc|readTextFile)\s*\(/g)].map(m=>m[1])).toEqual(["exec"]);
  expect(FILES).toContain('exec("sh", ["-c", LIST_SCRIPT, "files", path], { on })');
  expect(FILES).not.toMatch(/exec\s+as\s|\b(readTextFile|hc|watchFolder)\s*[,}]/);
  expect(FILES).not.toContain('exec("git"');
  expect(FILES).toContain("herdr-app@2405bf3");
  expect(readFileSync(join(PACK,"NOTICE.md"),"utf8")).toContain("mods/pdk-files/main.js");
  expect(readFileSync(join(PACK,"licenses/Apache-2.0.txt"),"utf8")).toContain("Apache License");
});

test("the stock listing script handles shell metacharacters as data and never reads contents", () => {
  const dir = `${ROOT}/dir ' $(touch owned)`;mkdirSync(`${dir}/nested`,{recursive:true});mkdirSync(`${dir}/.git`);
  for (const name of ['a.txt','space name.txt','$(touch sentinel)','quote".txt']) writeFileSync(`${dir}/${name}`,"private file contents");
  const r = Bun.spawnSync(["/bin/sh","-c",LIST_SCRIPT,"files",dir],{cwd:ROOT});
  expect(r.exitCode).toBe(0);expect(r.stdout.toString()).not.toContain("private file contents");
  const entries = parseDirectory(r.stdout.toString());
  expect(entries.map(e=>e.name).sort()).toEqual(['a.txt','space name.txt','$(touch sentinel)','quote".txt','nested'].sort());
  expect(existsSync(`${ROOT}/sentinel`)).toBe(false);expect(existsSync(`${ROOT}/owned`)).toBe(false);
  expect(parseDirectory('f\0../escape\0f\0bad/name\0f\0bad\nline\0')).toEqual([]);
});

test("bounded lazy tree keeps 500 per folder, 5000 total and reveals keyboard rows", () => {
  const tree = new FileTree('/project','box');
  tree.loaded('',Array.from({length:501},(_,i)=>({name:`f${i}.txt`,dir:false})));
  expect(tree.entries.get('').length).toBe(500);expect(tree.limited).toBe(true);
  for(let i=0;i<11;i++) tree.loaded(`dir${i}`,Array.from({length:501},(_,j)=>({name:`f${j}`,dir:false})));
  expect([...tree.entries.values()].reduce((n,e)=>n+e.length,0)).toBe(5000);
  tree.move('end');expect(tree.at).toBe(499);expect(tree.top+SHOWN).toBe(500);
  tree.move('home');expect(tree.at).toBe(0);expect(tree.top).toBe(0);
});

test("multi-selection returns listed files and folders as absolute paths on the pinned machine", () => {
  const tree = new FileTree('/remote/project','box');tree.loaded('',[{name:'sub',dir:true},{name:'space name.txt',dir:false},{name:'two.txt',dir:false}]);
  expect(tree.pick('../outside')).toBe(false);
  expect(tree.pick('sub')).toBe(true);expect(tree.ticked('sub')).toBe(true); // a folder is ticked as its path
  expect(tree.fold('sub')).toBe(true);tree.loaded('sub',[{name:'three.txt',dir:false}]);
  expect(tree.pick('space name.txt')).toBe(true);expect(tree.pick('sub/three.txt')).toBe(true);
  expect(tree.paths()).toEqual(['/remote/project/sub','/remote/project/space name.txt','/remote/project/sub/three.txt']);expect(tree.on).toBe('box');
  tree.fold('sub');expect(tree.paths()).toHaveLength(3); // selections persist when their branch folds
  expect(tree.pick('sub')).toBe(true);expect(tree.paths()).toHaveLength(2); // and untick
});

test("Up reaches the parent, keeps ticks, and stops at the root", () => {
  const tree = new FileTree('/home/me/project','box');tree.loaded('',[{name:'a.txt',dir:false},{name:'src',dir:true}]);
  tree.pick('a.txt');tree.fold('src');tree.at=1;
  expect(tree.up()).toBe(true);expect(tree.root).toBe('/home/me');expect(tree.entries.size).toBe(0);expect(tree.folders.size).toBe(0);expect(tree.at).toBe(0);
  tree.loaded('',[{name:'project',dir:true},{name:'notes',dir:true}]);expect(tree.pick('notes')).toBe(true);
  expect(tree.paths()).toEqual(['/home/me/project/a.txt','/home/me/notes']);expect(tree.on).toBe('box'); // a remote source stays remote
  expect(tree.up()).toBe(true);expect(tree.root).toBe('/home');expect(tree.up()).toBe(true);expect(tree.root).toBe('/');
  expect(tree.up()).toBe(false);expect(tree.root).toBe('/');
  tree.loaded('',[{name:'etc',dir:true}]);tree.pick('etc');expect(tree.paths()).toContain('/etc');
});

test("the 16-path limit holds for folders too, with its plain message", () => {
  const tree = new FileTree('/p',null);tree.loaded('',Array.from({length:17},(_,i)=>({name:`d${i}`,dir:true})));
  for(let i=0;i<16;i++) expect(tree.pick(`d${i}`)).toBe(true);
  expect(tree.pick('d16')).toBe(false);expect(tree.paths()).toHaveLength(16);
  const key=method(FILES,'key','attach'),view={tree,error:null,tick(p){if(!this.tree.pick(p))this.error='At most 16 paths and 16,384 characters';},close(){},toggle(){}};
  tree.at=tree.rows().findIndex(r=>r.path==='d16');key.call(view,'space',{notify(){}});expect(view.error).toBe('At most 16 paths and 16,384 characters');
});

test("attachment count, path length and combined length are bounded without partial mutation", () => {
  const d = new Drafts();d.swap(null,{text:'',attach:[]},'box/t1|s:A');const o=d.origin('box/t1|s:A');
  const paths=Array.from({length:16},(_,i)=>`/project/f${i}`);expect(d.attachTo(o,paths)).toBe(true);
  expect(d.attachTo(o,paths)).toBe(true);expect(d.shown.attach).toEqual(paths);
  expect(d.attachTo(o,['/project/extra'])).toBe(false);expect(d.shown.attach).toEqual(paths);
  for(const bad of [["relative"],["/bad\nname"],["/"+'a'.repeat(4096)],Array.from({length:17},(_,i)=>`/f${i}`),Array.from({length:5},(_,i)=>'/'+String(i).repeat(4000))]) expect(boundedAttachments(bad)).toBeNull();
});

test("actual chat receipt routes A→B→A to A, once; never to the focused B draft", () => {
  const d=new Drafts(),a='box/t1|s:A',b='box/t2|s:B';d.swap(null,{text:'',attach:[]},a);const request=source(d.origin(a));
  d.swap(a,{text:'A',attach:d.shown.attach},b);
  const view=deliver(d,request,['/project/one.txt','/project/space name.txt']);
  expect(d.shown.attach).toEqual([]);expect(view.fileRequests.size).toBe(0);
  expect(d.swap(b,{text:'B',attach:[]},a).attach).toEqual(['/project/one.txt','/project/space name.txt']);
  sendFiles.call(view,JSON.stringify({...request,paths:['/project/replay']}),{notify:()=>{}});expect(d.shown.attach).toHaveLength(2);
});

test("actual receipt discards wrong host/origin, traversal, retired draft and restarted process", () => {
  const d=new Drafts(),a='box/t1|s:A';d.swap(null,{text:'',attach:[]},a);const request=source(d.origin(a));
  for(const result of [{on:null},{origin:{key:a,gen:99}},{paths:['/project/../elsewhere']},{paths:['relative']}]) {
    deliver(d,request,['/project/good'],result);expect(d.shown.attach).toEqual([]);
  }
  d.retire(a);deliver(d,request,['/project/good']);expect(d.shown.attach).toEqual([]);
  const fresh=source(d.origin(a));currentTerms=[{address:'box/t1',foreground:{pid:20}}];deliver(d,fresh,['/project/good']);expect(d.shown.attach).toEqual([]);
  currentTerms=[{address:'box/t1',foreground:{pid:10}}];
});

test("\"+\" opens the browser at once with the agent's folder and machine; no menu, no local picker", () => {
  const open=method(CHAT,'openAttachments','receiveFiles',{openOverlay:o=>opened.push(o)});let opened=[];
  const src={origin:{key:'box/t1|s:A',gen:0},address:'box/t1',pid:10,cwd:'/remote/project',on:'box'};
  const view={attachmentOrigin:()=>src,fileRequests:new Map(),fileSequence:0,drafts:new Drafts()};
  open.call(view,{notify(){}});
  expect(opened).toHaveLength(1);expect(opened[0].mod).toBe('pdk-files');expect(opened[0].props.source).toMatchObject({cwd:'/remote/project',on:'box',address:'box/t1'});
  expect(view.fileRequests.size).toBe(1);
  expect(CHAT).not.toMatch(/attachMenu|attachmentMenu|pickFolder|attach-menu|attach-folder/);
  expect(CHAT).toContain('textButton(t, "attach", "+", "Attach files", (_e,cx) => this.openAttachments(cx)');
});

test("browser keys: Space ticks a file or folder, Enter and Right open a folder, Escape cancels and adds nothing", () => {
  const key=method(FILES,'key','attach'),tree=new FileTree('/p',null);tree.loaded('',[{name:'dir',dir:true},{name:'f.txt',dir:false}]);
  const toggled=[],ran=[];let closed=0;
  const view={tree,error:null,tick(p){this.tree.pick(p);},toggle:p=>toggled.push(p),close(){closed++;}};const cx={notify(){}};
  key.call(view,'space',cx);expect(tree.paths()).toEqual(['/p/dir']);
  key.call(view,'enter',cx);key.call(view,'right',cx);expect(toggled).toEqual(['dir','dir']);
  key.call(view,'down',cx);key.call(view,'space',cx);expect(tree.paths()).toEqual(['/p/dir','/p/f.txt']);
  key.call(view,'escape',cx);expect(closed).toBe(1);
  const close=method(FILES,'close','row',{run:c=>ran.push(c),props:()=>({}),closeOverlay(){}});
  close.call({request:{id:'r1'},context:{}});expect(ran).toEqual(['pdk-chat.attach-cancel:r1']); // Cancel says cancel, never attach
  expect(FILES).toContain('tick-${entry.path}');expect(FILES).toContain('"files-up", "Up"');expect(FILES).toContain('text_ellipsis_start()');
});

test("a ticked folder and a file arrive as the draft's chips, on the source machine", () => {
  const d=new Drafts(),a='box/t1|s:A';d.swap(null,{text:'',attach:[]},a);const request=source(d.origin(a));
  deliver(d,request,['/home/me','/project/one.txt']);expect(d.shown.attach).toEqual(['/home/me','/project/one.txt']);
  const wrong=new Drafts();wrong.swap(null,{text:'',attach:[]},a);deliver(wrong,source(wrong.origin(a)),['/home/me'],{on:null});expect(wrong.shown.attach).toEqual([]); // never relabelled local
});

test("install and uninstall include the new cloned mod and its shared draft contract", () => {
  const home=`${ROOT}/install/home`;mkdirSync(home,{recursive:true});
  const run = name => Bun.spawnSync(['/bin/sh',join(PACK,name),home],{env:{HOME:ROOT,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});
  expect(run('install.sh').exitCode).toBe(0);
  for(const name of ['main.js','model.js','mod.json','lib/composer.js']) expect(existsSync(`${home}/mods/pdk-files/${name}`)).toBe(true);
  expect(run('uninstall.sh').exitCode).toBe(0);expect(existsSync(`${home}/mods/pdk-files`)).toBe(false);
},30000);

test("returning through a provisional process key restores the kept session's text and delayed file chips", () => {
  const d=new Drafts(),ap='t1|p:10',a='t1|s:A',bp='t2|p:20';
  d.swap(null,{text:'',attach:[]},ap);d.swap(ap,{text:'',attach:[]},a);const origin=d.origin(a);
  d.swap(a,{text:'A text',attach:['/project/one']},bp);
  expect(d.attachTo(origin,['/project/two'])).toBe(true);
  const provisional=d.swap(bp,{text:'B text',attach:[]},ap);
  const restored=d.swap(ap,provisional,a);
  expect(restored).toEqual({text:'A text',attach:['/project/one','/project/two']});
});

test("a newly observed process/session retires a hidden origin; a full draft keeps its chips with a failure note", () => {
  const d=new Drafts(),ap='t1|p:10',a='t1|s:A',b='t2|p:30';
  d.swap(null,{text:'',attach:[]},ap);d.swap(ap,{text:'',attach:[]},a);const old=d.origin(a);
  d.swap(a,{text:'old',attach:[]},b);d.swap(b,{text:'',attach:[]},'t1|p:20');
  expect(d.attachTo(old,['/project/late'])).toBe(false);
  const f=new Drafts(),key='box/t1|s:X';f.swap(null,{text:'',attach:[]},key);
  const paths=Array.from({length:16},(_,i)=>`/project/f${i}`);f.attachTo(f.origin(key),paths);
  deliver(f,source(f.origin(key)),['/project/extra']);expect(f.shown.attach).toEqual(paths);expect(f.note(key)).toContain('attachment limit');
});
