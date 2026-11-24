// Shared Files/Changes dialog shell, with captured host/repo and explicit return route.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, closeOverlay, openOverlay } from "herdr";
import { TYPE, SPACE, ROW, monoFont, overlayHeader, segmentedChoice, actionButton, statusMarker } from "./ui.js";
export function closeUtility() {
  const p=props(); if(p.overlay)closeOverlay(p.overlay);
  if(p.returnCommand)run(p.returnCommand);
}
export function switchUtility(mode) {
  const p=props(); if(p.overlay)closeOverlay(p.overlay);
  openOverlay({mod:mode==="files"?"pdk-workspace-files":"pdk-changes",kind:"dialog",width:880,height:640,props:{...p,overlay:undefined,mode:mode==="files"?"browse":"changes"}});
}
export function utilityHeader(t, mode, target, count, refresh, disabled=false, owner=null) {
  return overlayHeader(t,"utility-header","Files and Changes",{ground:t.canvas,trailing:h_flex().gap(SPACE[2]).items_center()
    .child(segmentedChoice(t,"utility-modes",[{value:"files",label:"Files"},{value:"changes",label:"Changes"}],mode,v=>switchUtility(v),{variant:"navigation",ground:t.canvas,disabled,owner}))
    .child(div().text_size(TYPE.xs).text_color(t.dim).child(count ?? ""))
    .child(actionButton(t,"utility-close","Close","Close Files and Changes",closeUtility,{disabled}))});
}
export function utilityContext(t, target, root, refresh, disabled=false) {
  const text=target?`${target.name} · ${target.machine || "This computer"} · ${root || target.folder}`:"No captured workspace";
  return h_flex().h(ROW.base).flex_none().px(SPACE[3]).gap(SPACE[2]).items_center().border_b(1).border_color(t.border)
    .child(div().flex_1().min_w(0).truncate().text_size(TYPE.xs).font_family(monoFont()).text_color(t.muted).tooltip(text).child(text))
    .child(actionButton(t,"utility-refresh","Refresh","Refresh captured workspace",refresh,{disabled}));
}
export function utilityError(t, id, text) {
  return h_flex().id(id).h(ROW.two).flex_none().px(SPACE[3]).gap(SPACE[2]).items_center().tooltip(text)
    .child(div().flex_1().min_w(0).max_h(SPACE[8]).overflow_hidden().text_size(TYPE.sm).line_height(`${SPACE[4]}px`).text_color(t.foreground).child(text))
    .child(statusMarker(t,"needs",`${id}-status`));
}
