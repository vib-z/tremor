import {test,expect,afterAll} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {harness,evaluate,world} from './parity-harness.js';
import * as workspace from '../adapters/workspace.js';
const ROOT=mkdtempSync(join(tmpdir(),'pdk-final-panels-'));
afterAll(()=>rmSync(ROOT,{recursive:true,force:true}));
const text=n=>typeof n==='string'?[n]:(n?.kids??[]).flatMap(text);
function changes(files,limited){
 const h=harness(world(2)),env={...h.env,...workspace};Object.assign(env,evaluate('shared/workspace-dialog.js',env,'({utilityHeader,utilityContext,utilityError,closeUtility})'));
 const Changes=evaluate('mods/pdk-changes/main.js',env,'Changes'),v=new Changes();
 Object.assign(v,{target:{space:'A',name:'Alpha',machine:null,folder:'/repo/a'},files:Array.from({length:files},(_,i)=>({path:`${i}.txt`,status:'M',add:1,del:0})),rows:[],root:'/repo/a',diffWidth:300,limited,message:'',handle:{is_focused:()=>false},input:h.env.InputState.new({})});
 return text(v.render(h.cx));
}
test('F3 Changes shares singular/plural count across header/footer; limited one stays plural and all-files consequence stays explicit',()=>{
 for(const [count,limited,label]of [[0,false,'0 files'],[1,false,'1 file'],[2,false,'2 files'],[1,true,'1+ files']]){
  const words=changes(count,limited);expect(words.some(s=>s.startsWith(`${label} · +`))).toBe(true);expect(words).toContain(`${label} · Stages and commits all changes, including untracked files`);expect(words.some(s=>/^1 files\b/.test(s))).toBe(false);
 }
});
