import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, lstatSync, readlinkSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { contrast } from "../adapters/tokens.js";
const PACK = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROOT = mkdtempSync("/tmp/pdk-program-overlay-");
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const fresh = name => { const h=join(ROOT,name,"home");mkdirSync(h,{recursive:true});return h; };
const OVERLAY=JSON.parse(readFileSync(`${PACK}/pdk-programs.json`,"utf8"));
const LIB=readFileSync(`${PACK}/install-lib.sh`,"utf8").split("keys_file() {")[1].split("<<'PY'\n")[1].split("\nPY\n")[0];
function only(mode,home,family="programs",outside="",pack=PACK) {
 const wrapper=`import os,sys
source,operation,home,pack,family,outside=sys.argv[1:]
real_open=os.open
injected=False
def guarded(name,flags,mode=0o777,*,dir_fd=None):
 global injected
 if isinstance(name,str) and name.endswith('.pdk-tmp'):
  assert flags & os.O_EXCL and flags & os.O_NOFOLLOW
 if outside and name == family+'.json.pdk-tmp':
  os.symlink(outside,name,dir_fd=dir_fd); injected=True
 return real_open(name,flags,mode,dir_fd=dir_fd)
os.open=guarded
sys.argv=['overlay',operation,home,pack,home+'/.pdk-backup',family]
try: exec(compile(source,'overlay','exec'))
finally: print('LATE_TEMP_INJECTED='+str(injected))
`;
 const r=Bun.spawnSync(['/usr/bin/python3','-I','-S','-c',wrapper,LIB,mode,home,pack,family,outside],{env:{HOME:ROOT,PATH:'/usr/bin:/bin'}});
 return {code:r.exitCode,out:r.stdout.toString()+r.stderr.toString()};
}
const full=(script,home)=>{const r=Bun.spawnSync(['/bin/sh',`${PACK}/${script}`,home],{env:{HOME:ROOT,PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});return {code:r.exitCode,out:r.stdout.toString()+r.stderr.toString()};};

test('program overlay: only matching stock agent keys and icon/tint/brand/tile, never launch or matching fields',()=>{
 expect(Object.keys(OVERLAY)).toEqual(['programs']);
 // Verified against herdr-app@2405bf3 defaults/programs.json. Absent stock agents are not invented.
 expect(Object.keys(OVERLAY.programs).sort()).toEqual(['antigravity','claude','codex','copilot','cursor','gemini','grok','hermes','kimi','opencode','pi','qoder']);
 const ui=readFileSync(`${PACK}/shared/ui.js`,'utf8');
 for(const [key,v] of Object.entries(OVERLAY.programs)){
  expect(Object.keys(v).sort()).toEqual(['color','icon','tile','tint']);expect(v.tint).toBe(false);
  expect(v.icon).toBe(`pdk/icons/agents-colour/${key}.svg`);expect(existsSync(`${PACK}/icons/agents-colour/${key}.svg`)).toBe(true);
  const brand=ui.match(new RegExp(`^  ${key}: \\{ name: "[^"]+", color: "(#[0-9a-f]+)"`,'m'))?.[1];expect(JSON.parse(readFileSync(`${PACK}/icons/agents-colour.json`,"utf8")).marks[key].brand).toBe(brand);
  expect(contrast(v.color,v.tile),key).toBeGreaterThanOrEqual(3);
 }
});

test('programs: absent file is created, idempotent, then removed; unrelated JSON formatting is restored byte for byte',()=>{
 for(const [id,original] of [['absent',null],['empty','{}\r\n'],['existing',' { "programs" : {"other":{"run":["x"],"name":"Élodie"}}, "shells" : ["fish"] }\r\n'],['fields','{ "programs": { "claude": {"run":["custom-claude"], "name":"My Claude", "match":["custom"]}, "codex": {} } }\n']]){
  const h=fresh(id);if(original!==null)writeFileSync(`${h}/programs.json`,original);
  expect(only('merge',h).code).toBe(0);const made=readFileSync(`${h}/programs.json`,'utf8'),cur=JSON.parse(made);
  for(const [k,v] of Object.entries(OVERLAY.programs))expect(cur.programs[k]).toMatchObject(v);
  if(id==='fields')expect(cur.programs.claude.run).toEqual(['custom-claude']);
  if(original!==null)expect(readFileSync(`${h}/.pdk-backup/programs/original`,'utf8')).toBe(original);
  expect(only('merge',h).code).toBe(0);expect(readFileSync(`${h}/programs.json`,'utf8')).toBe(made);
  expect(only('unmerge',h).code).toBe(0);
  if(original===null)expect(existsSync(`${h}/programs.json`)).toBe(false);else expect(readFileSync(`${h}/programs.json`,'utf8')).toBe(original);
 }
});

test('programs: any existing visual field skips that whole entry and preserves run/name/match and unrelated edits',()=>{
 const h=fresh('custom');const old={programs:{claude:{icon:'mine.svg',name:'Mine',run:['mine']},codex:{color:null},cursor:{tint:false},hermes:{tile:'#000000'},other:{icon:'other.svg'}},interpreters:['private']};
 const original=JSON.stringify(old,null,3)+'\n';writeFileSync(`${h}/programs.json`,original);const r=only('merge',h);expect(r.code).toBe(0);
 for(const k of ['claude','codex','cursor','hermes'])expect(r.out).toContain(k+' already customised');
 const text=readFileSync(`${h}/programs.json`,'utf8'),cur=JSON.parse(text);
 for(const k of ['claude','codex','cursor','hermes','other'])expect(cur.programs[k]).toEqual(old.programs[k]);
 writeFileSync(`${h}/programs.json`,text.replace('"private"','"private", "another"'));expect(only('unmerge',h).code).toBe(0);
 expect(readFileSync(`${h}/programs.json`,'utf8')).toBe(original.replace('"private"','"private", "another"'));
});

test('programs: invalid, duplicate-key and non-object overlays are reported and left unchanged',()=>{
 for(const [i,text] of ['[1]','{not json}','{"programs": []}','{"programs":{},"programs":{}}'].entries()){
  const h=fresh('invalid'+i);writeFileSync(`${h}/programs.json`,text);expect(only('merge',h).code).toBe(0);expect(readFileSync(`${h}/programs.json`,'utf8')).toBe(text);
 }
});

test('programs: later neighbours in an originally empty object survive valid, exact block removal',()=>{
 for(const side of ['before','after']){
  const h=fresh('neighbour'+side);expect(only('merge',h).code).toBe(0);let text=readFileSync(`${h}/programs.json`,'utf8');
  text=side==='before'?text.replace('{','{"mine": true,'):text.replace(/}\s*$/,' , "mine": true}\n');
  expect(JSON.parse(text).mine).toBe(true);writeFileSync(`${h}/programs.json`,text);expect(only('unmerge',h).code).toBe(0);expect(JSON.parse(readFileSync(`${h}/programs.json`,'utf8'))).toEqual({mine:true});
 }
});

for(const mode of ['merge','unmerge'])test(`programs: ${mode} temp link is refused before staging; outside sentinel unchanged`,()=>{
 const h=fresh('preflight-'+mode);if(mode==='unmerge')expect(full('install.sh',h).code).toBe(0);
 const outside=join(ROOT,'outside-'+mode);writeFileSync(outside,'sentinel');chmodSync(outside,0o640);const st=lstatSync(outside);
 symlinkSync(outside,`${h}/programs.json.pdk-tmp`);const before=readdirSync(h).sort();const r=full(mode==='merge'?'install.sh':'uninstall.sh',h);
 expect(r.code).toBe(1);expect(r.out).toContain('programs.json.pdk-tmp');expect(readdirSync(h).sort()).toEqual(before);
 expect(readFileSync(outside,'utf8')).toBe('sentinel');expect(lstatSync(outside).ino).toBe(st.ino);expect(lstatSync(outside).mode).toBe(st.mode);
},30000);

for(const mode of ['merge','unmerge'])test(`programs: ${mode} rejects a late temp insertion, preserving inode/mode and leaving foreign link alone`,()=>{
 const h=fresh('late-'+mode);writeFileSync(`${h}/programs.json`,'{}\n');chmodSync(`${h}/programs.json`,0o600);if(mode==='unmerge')expect(only('merge',h).code).toBe(0);
 const before=readFileSync(`${h}/programs.json`),st=lstatSync(`${h}/programs.json`),outside=join(ROOT,'late-out-'+mode);writeFileSync(outside,'outside');chmodSync(outside,0o640);const o=lstatSync(outside);
 const r=only(mode,h,'programs',outside);expect(r.code).toBe(1);expect(r.out).toContain('LATE_TEMP_INJECTED=True');expect(readFileSync(`${h}/programs.json`)).toEqual(before);expect(lstatSync(`${h}/programs.json`).ino).toBe(st.ino);expect(lstatSync(`${h}/programs.json`).mode).toBe(st.mode);
 expect(readlinkSync(`${h}/programs.json.pdk-tmp`)).toBe(outside);expect(readFileSync(outside,'utf8')).toBe('outside');expect(lstatSync(outside).ino).toBe(o.ino);expect(lstatSync(outside).mode).toBe(o.mode);
});

test('programs: successful replacement is atomic, retains mode; links in file or backup/journal parents are refused',()=>{
 const h=fresh('atomic');writeFileSync(`${h}/programs.json`,'{}\n');chmodSync(`${h}/programs.json`,0o600);const ino=lstatSync(`${h}/programs.json`).ino;
 expect(only('merge',h).code).toBe(0);expect(lstatSync(`${h}/programs.json`).ino).not.toBe(ino);expect(lstatSync(`${h}/programs.json`).mode&0o777).toBe(0o600);
 expect(only('unmerge',h).code).toBe(0);expect(readFileSync(`${h}/programs.json`,'utf8')).toBe('{}\n');expect(lstatSync(`${h}/programs.json`).mode&0o777).toBe(0o600);
 for(const rel of ['programs.json','.pdk-backup/programs','.pdk-backup/programs/added.pdk-tmp']){
  const t=fresh('link-'+rel.replaceAll('/','-')),out=join(ROOT,'link-out-'+rel.replaceAll('/','-'));mkdirSync(join(t,rel,'..'),{recursive:true});writeFileSync(out,'sentinel');symlinkSync(out,join(t,rel));expect(only('preflight',t).code).toBe(1);expect(readFileSync(out,'utf8')).toBe('sentinel');
 }
});

test('programs: edited owned block refuses full uninstall before keys or installed assets are removed',()=>{
 const h=fresh('edited');expect(full('install.sh',h).code).toBe(0);const key=readFileSync(`${h}/keys.json`,'utf8');
 const text=readFileSync(`${h}/programs.json`,'utf8');writeFileSync(`${h}/programs.json`,JSON.stringify(JSON.parse(text),null,2));
 const r=full('uninstall.sh',h);expect(r.code).toBe(1);expect(r.out).toContain('logo blocks were edited');expect(readFileSync(`${h}/keys.json`,'utf8')).toBe(key);expect(existsSync(`${h}/pdk/icons/agents/codex.svg`)).toBe(true);
},30000);

for(const created of [false,true])test(`keys: a pdk-era block (layout:pdk) is upgraded to layout:tremor or removed, created=${created}`,()=>{
 const h=fresh('upgrade-'+created),base='{"global":{"cmd-p":"mod.open:picker"}}\n';
 const block=',\n  "layout:pdk": {\n    "cmd-k": "mod.open:pdk-search"\n  }';const old=base.replace('}}','}'+block+'}');
 mkdirSync(`${h}/.pdk-backup/keys`,{recursive:true});writeFileSync(`${h}/keys.json`,old);writeFileSync(`${h}/.pdk-backup/keys/added`,block);if(created)writeFileSync(`${h}/.pdk-backup/keys/created`,old);else writeFileSync(`${h}/.pdk-backup/keys/original`,base);
 expect(only('merge',h,'keys').code).toBe(0);const up=JSON.parse(readFileSync(`${h}/keys.json`,'utf8'));expect(up['layout:pdk']).toBeUndefined();expect(up['layout:tremor']).toEqual({'cmd-k':'mod.open:pdk-search','cmd-p':'mod.open:pdk-search'});
 expect(only('unmerge',h,'keys').code).toBe(0);if(created)expect(existsSync(`${h}/keys.json`)).toBe(false);else expect(readFileSync(`${h}/keys.json`,'utf8')).toBe(base);
 // Current uninstaller must also remove an old block without an intervening upgrade.
 writeFileSync(`${h}/keys.json`,old);writeFileSync(`${h}/.pdk-backup/keys/added`,block);if(existsSync(`${h}/.pdk-backup/keys/created`))rmSync(`${h}/.pdk-backup/keys/created`);
 expect(only('unmerge',h,'keys').code).toBe(0);expect(readFileSync(`${h}/keys.json`,'utf8')).toBe(base);
});

test('keys: custom Cmd+P in global/terminal/layout stays; only the exact stock global picker is shadowed',()=>{
 for(const [i,base] of [{global:{'cmd-p':'app.palette'}},{terminal:{'cmd-p':'send:x'}},{'layout:tremor':{'cmd-p':'mine'}}].entries()){
  const h=fresh('custom-p'+i),text=JSON.stringify(base);writeFileSync(`${h}/keys.json`,text);expect(only('merge',h,'keys').code).toBe(0);
  const got=JSON.parse(readFileSync(`${h}/keys.json`,'utf8'));expect(got[Object.keys(base)[0]]['cmd-p']).toBe(Object.values(base)[0]['cmd-p']);expect(got['layout:tremor']?.['cmd-p']).not.toBe('mod.open:pdk-search');
  expect(only('unmerge',h,'keys').code).toBe(0);expect(readFileSync(`${h}/keys.json`,'utf8')).toBe(text);
 }
});


test('programs: a journal written before the atomic overlay replacement resumes safely',()=>{
 for(const absent of [true,false]){
  const h=fresh('pending-'+absent),base='{ "other": "preserve" }\n';if(!absent)writeFileSync(`${h}/programs.json`,base);
  expect(only('merge',h).code).toBe(0);
  if(absent)rmSync(`${h}/programs.json`);else writeFileSync(`${h}/programs.json`,base);
  expect(only('merge',h).code).toBe(0);expect(JSON.parse(readFileSync(`${h}/programs.json`,'utf8')).programs.codex.icon).toBe(OVERLAY.programs.codex.icon);
  expect(only('unmerge',h).code).toBe(0);if(absent)expect(existsSync(`${h}/programs.json`)).toBe(false);else expect(readFileSync(`${h}/programs.json`,'utf8')).toBe(base);
 }
});


test('programs: upgrading the exact previous text-tinted overlay keeps original text and created-file ownership',()=>{
 for(const absent of [true,false]){
  const h=fresh('old-tint-'+absent),base='{ "programs": {"custom": {"run": ["mine"]}}, "note": "untouched" }\r\n';if(!absent)writeFileSync(`${h}/programs.json`,base);
  const oldPack=join(ROOT,'old-pack-'+absent);mkdirSync(oldPack);const old=JSON.parse(JSON.stringify(OVERLAY));
  const info=JSON.parse(readFileSync(`${PACK}/icons/agents-colour.json`,'utf8'));
  for(const [k,v] of Object.entries(old.programs)){v.icon=`pdk/icons/agents/${k}.svg`;v.tint=true;v.color=info.marks[k].brand;}
  writeFileSync(join(oldPack,'pdk-programs.json'),JSON.stringify(old));
  expect(only('merge',h,'programs','',oldPack).code).toBe(0);expect(JSON.parse(readFileSync(`${h}/programs.json`,'utf8')).programs.claude.tint).toBe(true);
  const upgrade=only('merge',h);expect(upgrade.code).toBe(0);expect(upgrade.out).toContain('upgrading the previous owned logo overlay');
  expect(JSON.parse(readFileSync(`${h}/programs.json`,'utf8')).programs.claude).toEqual(OVERLAY.programs.claude);
  expect(only('merge',h).out).toContain('logos already installed');
  expect(only('unmerge',h).code).toBe(0);if(absent)expect(existsSync(`${h}/programs.json`)).toBe(false);else {expect(readFileSync(`${h}/programs.json`,'utf8')).toBe(base);expect(readFileSync(`${h}/.pdk-backup/programs/original`,'utf8')).toBe(base);}
 }
});

test('colour assets install and uninstall exactly, restoring a pre-existing coloured file',()=>{
 const h=fresh('coloured-install'),asset=`${h}/pdk/icons/agents-colour/claude.svg`;mkdirSync(join(asset,'..'),{recursive:true});writeFileSync(asset,'original coloured asset');
 expect(full('install.sh',h).code).toBe(0);
 for(const v of Object.values(OVERLAY.programs))expect(readFileSync(`${h}/${v.icon}`,'utf8')).toBe(readFileSync(`${PACK}/${v.icon.slice(4)}`,'utf8'));
 expect(full('uninstall.sh',h).code).toBe(0);expect(readFileSync(asset,'utf8')).toBe('original coloured asset');
 expect(readdirSync(`${h}/pdk/icons/agents-colour`)).toEqual(['claude.svg']);expect(existsSync(`${h}/programs.json`)).toBe(false);
},30000);
