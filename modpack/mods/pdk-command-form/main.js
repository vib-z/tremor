// Clone of herdr-app@2405bf3 defaults/mods/prompt/main.js, Apache-2.0.
// Native name argument semantics; captured target revalidation and the shared scale/frame/controls.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, run, closeOverlay, theme, spaces, terminals, machines, panes, nextCommand } from "herdr";
import { targetAvailable } from "./lib/search-commands.js";
import { TYPE, SPACE, ROW, RADIUS, withFont, overlayHeader, overlayFrame, actionButton, fieldFrame } from "./lib/ui.js";
import { utilityError } from "./lib/workspace-dialog.js";
export default class Arguments extends View {
 init(_props,cx){this.text="";this.error=null;this.input=InputState.new({placeholder:"Name"});this.input.on("change",(_e,cx)=>{this.text=this.input.value();cx.notify();});this.input.on("submit",()=>this.submit(cx));this.input.on("focus",(_e,cx)=>{this.typing=true;cx.notify();});this.input.on("blur",(_e,cx)=>{this.typing=false;cx.notify();});this.input.focus();cx.timer.after(600,()=>this.input.focus());this.handle=cx.focus_handle();cx.spawn(async cx=>{for(;;){const c=await nextCommand();if(c.startsWith("value:")){this.text=c.slice(6);this.input.set_value(this.text);}else if(c==="submit")this.submit(cx);cx.notify();}});}
 submit(cx){const p=props()??{},snapshot={spaces:spaces(),terminals:terminals(),machines:machines(),panes:panes()};if(p.target&&!targetAvailable(p.command?.name.startsWith("tab.")?{...p.target,id:p.command.args.id}:p.target,snapshot,p.command?.name.startsWith("tab.")?"tab":"space")){this.error="Captured workspace is no longer available";cx.notify();return;}if(!this.text.trim()||!p.command)return;closeOverlay(p.overlay);run(p.command.name,{...p.command.args,name:this.text});}
 render(cx){const t=theme(),p=props()??{};return withFont(overlayFrame(t,"pdk-command-form",{hostFrame:true})).w_full().track_focus(this.handle)
 .on_key_down((e,cx)=>{if(e.key==="escape"){closeOverlay(p.overlay);cx.stop_propagation();}})
 .child(overlayHeader(t,"command-form-head",p.title||"Command arguments"))
 .child(v_flex().p(SPACE[3]).gap(SPACE[2]).child(div().text_size(TYPE.sm).text_color(t.muted).child("Name"))
 .child(fieldFrame(h_flex().h(ROW.base).px(SPACE[3]).rounded(RADIUS.lg),t,{focused:this.typing}).child(Input.new(this.input).w_full().h_full().bg(t.surface).border_0().text_size(TYPE.base).text_color(t.foreground)))
 .when(Boolean(p.target),el=>el.child(div().text_size(TYPE.xs).text_color(t.dim).child(`${p.target.name} · ${p.target.machine||"This computer"}`)))
 .when(Boolean(this.error),el=>el.child(utilityError(t,"command-form-error",this.error)))
 .child(h_flex().gap(SPACE[2]).justify_end().child(actionButton(t,"command-cancel","Cancel","Cancel command",()=>closeOverlay(p.overlay)))
 .child(actionButton(t,"command-run","Run","Run command with this name",()=>this.submit(cx),{variant:"primary",disabled:!this.text.trim()}))));}
}
