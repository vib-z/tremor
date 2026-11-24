// pdk-search: the Cmd+K palette (owner 17:40 request 4b). It finds machines, workspaces, tabs, agents and panes,
// named as the sidebar names them, and focuses the one picked through the app's own commands. Type to filter,
// ↑/↓ to move, Enter to go, Esc to clear the filter and then to close.
//
// One way in: `mod.open:pdk-search`, from Cmd+K (the pack's keys.json, `layout:tremor` only) and from the sidebar's
// search field (17:52 request 8b) alike, so both open the same palette in the same state. mod.open toggles: a
// second press closes it (herdr-app docs/commands.md, mod.open). Laid out after Herdr's own picker overlay
// (herdr-app@2405bf3 defaults/mods/picker, Apache-2.0). Live data only; colours are theme tokens.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, terminals, agents, machines, shared, setShared, theme, run, props, focused, commands, layouts, keys, openOverlay, closeOverlay, nextCommand } from "herdr";
import { searchRows, placeList, keepInView, SearchSelection } from "./lib/search.js";
import { commandRows, commandList, placeCommands, captureSearchContext, targetAvailable } from "./lib/search-commands.js";
import { MACHINE_KEYS, nativeMenu, STATUS_WORD } from "./lib/status.js";
import { HOVER_KEY } from "./lib/views.js";
import { TYPE, SPACE, ROW, ICON, RADIUS, withFont, icon, kindOf, kindMarker, statusMarker, rowStates, segmentedChoice, textButton, kbd, softInk } from "./lib/ui.js";

// The visual contract's palette (option-a-rest, 01): the field is the frame's 40 px top row (12 px in, a 14 px search
// glyph, Esc at its right) over a bottom edge; the list 4 px in, each destination 40 high, 8 px in, its mark 14, its
// name 13 in softInk over its place 11 dim, its status at the right; a 36 px foot of keys. Every name starts after
// one mark column, empty on rows without a mark.
const SHOWN = 9;
const PAD = SPACE[3];
const MARK = ICON.base;
// The palette's keys, bound under the field ("PdkSearch > Input" matches at the field's own depth, and a later binding
// wins a tie). On the 0.1.14 source a one-line field registers no handler for ↑ ↓ PgUp PgDn Tab Shift-Tab (they are
// wired for multi-line only, base input/base/state.rs:4643-4663), so they already fall through to the root's
// on_key_down, which handles them; the bindings make that independent of how a host version wires its Input. A bound
// action stops there (gpui stops an action in its bubble phase by default), so a key never takes both paths.
// Escape too: the field passes it on, and the host's escape → overlay.close (context `Overlay`) would close the popup
// before a query could be cleared.
const FIELD_KEYS = ["up", "down", "pageup", "pagedown", "tab", "shift-tab", "ctrl-d", "alt-enter", "escape"];
let bound = false; // once per module load: the keymap is the app's, matched against every keystroke in every terminal
const action = (key) => `pdk_search_${key.replace("-", "_")}`;

export default class Search extends View {
  init(_props, cx) {
    this.context=captureSearchContext(this.snapshot()); this.mode="places"; this.showEarlier=false; this.recent=shared("pdk.search.recent")??[];
    this.query = "";
    this.choice = new SearchSelection();
    this.top = 0;
    this.inputFocused = false;
    this.acted = false;
    this.wheel = 0;
    this.input = InputState.new({ placeholder: "Search Places or > Commands" });
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.on("change", (_e, cx) => { this.acted = true; this.setQuery(this.input.value(), cx); });
    this.input.on("submit", (_e, cx) => { this.acted = true; this.go(null, cx); });
    // ponytail: bound once per module load; a keys.json reload clears them until the app reloads this mod, and until
    // then on_key_down still handles the keys. A host that refuses them leaves the palette as it was without them.
    // Escape also under the root, for when the list holds the keyboard: no Input is in the path then, and the host's
    // Overlay binding would close the popup with text still in it. With the field focused the deeper binding wins.
    if (!bound) try { bound = cx.bind_keys([...FIELD_KEYS.map((keystroke) => ({ keystroke, action: action(keystroke), context: "PdkSearch > Input" })),
      { keystroke: "escape", action: action("escape"), context: "PdkSearch" }]) > 0; } catch {}
    // The popup takes the keyboard as it opens, a frame or more after this, and the field may already have had it:
    // for the first 600 ms, ask for the field on each frame it lacks focus, never once the person has pressed a key
    // or clicked.
    this.input.focus();
    const opened = Date.now();
    const early = cx.timer.every(16, () => {
      if (this.acted || Date.now() - opened > 600) early?.cancel();
      else if (!this.inputFocused) this.input.focus();
    });
    this.handle = cx.focus_handle();
    // While it is open, bindable in keys.json and how the sandbox drives it without input (C evidence):
    // "pdk-search.query:<text>" types the filter, "pdk-search.down" / ".up" move, "pdk-search.pick" is Enter.
    // "pdk-search.focus:field|list" moves actual host focus for command-only checks.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if(c.startsWith("mode:"))this.switchMode(c.slice(5),cx);
        else if(c==="pagedown"||c==="pageup")this.press(c,cx);
        else if(c==="actions")this.actions(cx);
        else if(c==="close-tab")this.closeTab(cx);
        else if(c==="earlier"){this.showEarlier=!this.showEarlier;this.choice.reset();}
        else if (c.startsWith("query:")) this.setQuery(c.slice(6), cx);
        else if (c === "down" || c === "up") this.move(c === "down" ? 1 : -1, cx);
        else if (c === "pick") this.go(null, cx);
        else if (c === "focus:field") this.input.focus();
        else if (c === "focus:list") this.handle.focus();
        cx.notify();
      }
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // The list from live data, and the rows a pick can land on. Built where it is used (1-2 ms for 100 rows in the
  // sandbox), so the keys and commands never act on a list a render left behind.
  snapshot(){return {spaces:spaces(),panes:panes(),terminals:terminals(),agents:agents(),machines:machines(),focus:focused()};}
  // One mode rule: the field is the truth. A leading ">" is Commands, none is Places, however it got there (typing,
  // Backspace, Tab, the segment). A switch adds or removes the ">" and keeps the words after it, and the field keeps
  // the keyboard with the cursor at the end.
  setQuery(q, cx) {
    this.query = q; this.mode = q.startsWith(">") ? "commands" : "places";
    if (this.input.value() !== q) this.input.set_value(q); // a one-line field puts the caret at the end (base state.rs:1152)
    this.choice.reset(); this.selected(); this.top = 0; cx?.notify();
  }
  switchMode(mode, cx) {
    if (!["places", "commands"].includes(mode)) return;
    const words = this.query.replace(/^>\s*/, "");
    this.setQuery(mode === "commands" ? `>${words}` : words, cx);
    this.input.focus();
  }
  list() {
    const snapshot=this.snapshot();
    const cmds=()=>commandRows({catalogue:commands(),layouts:layouts(),bindings:keys(),context:this.context,snapshot,scope:{layout:shared("layout")??"tremor",terminal:Boolean(this.context?.terminal)}});
    if(this.mode==="commands")return commandList(cmds(),this.query,this.recent);
    const all=searchRows({...snapshot,kindOf});
    // A Places search also lists its best few commands under the places (K4); ">" stays the commands-only filter.
    return [...placeList(all,this.query,this.showEarlier,snapshot),...(this.query.trim()?placeCommands(cmds(),this.query):[])];
  }
  actions(cx) {
    const row=this.selected(); if(!row?.target)return;
    const tab=row.kind==="workspace"||row.kind==="command"?"space":row.kind==="tab"?"tab":row.kind==="machine"?"machine":"agent";
    if(!targetAvailable(row.target,this.snapshot(),tab)){this.choice.missing=true;cx?.notify();return;}
    const target={...row.target},trigger=row.key;this.close();
    // Herdr's own menu for a workspace or a tab (spec §5); the pack's for an agent or a machine.
    if(tab==="space"||tab==="tab"){openOverlay(nativeMenu(tab,tab==="space"?{id:target.id}:{id:target.id,space:target.space}));return;}
    openOverlay({mod:"pdk-tree",kind:"popup",width:280,props:{part:"menu",tab,target,trigger,returnCommand:`pdk-tree.focus:${trigger}`}});
  }
  closeTab(cx) {
    const r=this.selected();if(!r||r.kind!=="tab")return;
    if(!targetAvailable(r.target,this.snapshot(),"tab")){this.choice.missing=true;cx?.notify();return;}
    this.close();run("tab.close",{id:r.target.id});
  }

  selected(picks = this.list().filter((r) => r.command)) {
    return this.choice.current(picks);
  }

  go(key = null, cx = null) {
    if (key != null) this.choice.choose(key);
    // Re-resolve the current command for this key at submit, never a rendered row or array index.
    const row = this.selected();
    if (!row) { cx?.notify(); return; }
    if(row.command.name==="actions"){this.actions(cx);return;}
    if(row.kind==="earlier"){this.showEarlier=!this.showEarlier;this.choice.reset();cx?.notify();return;}
    const type=row.kind==="tab"?"tab":row.kind==="workspace"||row.kind==="command"?"space":row.kind==="machine"?"machine":"agent";
    if(row.target&&!targetAvailable(row.target,this.snapshot(),type)){this.choice.missing=true;cx?.notify();return;}
    if(row.kind==="command") {this.recent=[row.key,...this.recent.filter(k=>k!==row.key)].slice(0,20);setShared("pdk.search.recent",this.recent);}
    if(row.command.name==="pdk-search.mode:places"){this.setQuery("",cx);this.input.focus();return;} // the row clears the filter
    if(row.command.name==="pdk-pane.hover"){this.close();setShared(HOVER_KEY,row.command.args.style);return;}
    this.close();
    // Spec §2: a destination on another machine than the one the filter shows moves the filter there (All stays All).
    const filter=shared(MACHINE_KEYS.filter)??"all";
    if(row.kind!=="command"&&row.target&&"machine" in row.target&&filter!=="all"&&(row.target.machine??"")!==filter)setShared(MACHINE_KEYS.filter,row.target.machine??"");
    if(row.needsName){openOverlay({mod:"pdk-command-form",kind:"dialog",width:440,props:{title:row.label,command:row.command,target:row.target}});return;}
    if(row.command.args?.name==="pdk-new-menu"&&row.target){run("space.select",{id:row.target.space});if(row.target.tab)run("tab.select",{id:row.target.tab});}
    if(["terminal.copy","terminal.paste","terminal.paste_image","terminal.search","pane.go","pane.swap"].includes(row.command.name)&&row.target?.pane)run("pane.focus",{pane:row.target.pane});
    if(row.command.name==="mod.open"&&row.command.args?.props){openOverlay({mod:row.command.args.name,kind:"dialog",width:880,height:640,props:row.command.args.props});return;}
    run(row.command.name,row.command.args);
  }

  move(by, cx) {
    this.choice.move(this.list(), by);
    cx.notify();
  }

  // One meaning per key, from the field (its bindings' actions) and from the list (on_key_down) alike.
  press(key, cx) {
    this.acted = true;
    if (key === "up" || key === "down") this.move(key === "down" ? 1 : -1, cx);
    else if (key === "pageup" || key === "pagedown") { this.choice.jump(this.list(), key === "pagedown" ? 1 : -1); cx.notify(); }
    else if (key === "tab" || key === "shift-tab") this.switchMode(this.mode === "commands" ? "places" : "commands", cx);
    else if (key === "ctrl-d") this.closeTab(cx);
    else if (key === "alt-enter") this.actions(cx);
    else if (key === "enter") this.go(null, cx);
    else if (key === "escape") { if (this.query) { this.setQuery("", cx); this.input.focus(); } else this.close(); } // clear first, then close
    else return false;
    return true;
  }

  // The palette's root: the key context the field's bindings name, an action per bound key, and a click counts as
  // acting (the early focus stops).
  keyed(el) {
    for (const key of FIELD_KEYS) el = el.on_action(action(key), (_e, cx) => this.press(key, cx));
    return el.key_context("PdkSearch").on_mouse_down("left", () => { this.acted = true; });
  }

  row(t, r, on) {
    if (r.head) {
      return h_flex().id(`ps-${r.key}`).h(ROW.base).flex_none().px(SPACE[2]).pb(SPACE[1]).gap(SPACE[2]).items_end()
        .text_size(TYPE.xs).font_medium().text_color(t.dim).role("heading").accessibility_label(`${r.label}, ${r.count}`)
        .child(r.label).child(div().child(String(r.count)));
    }
    const live = Boolean(r.command);
    // The mark the tab bar draws, then the name over its place; the kind is in the row's accessible name (owner
    // request 14). A panel, which has no mark, says "panel". The status as the sidebar draws it.
    const slot = div().w(MARK).flex_none().flex().items_center().justify_center()
      .when(Boolean(r.mark), (el) => el.child(kindMarker(t, r.mark, ICON.base, on ? t.foreground : t.muted, `ps-mark-${r.key}`)));
    const marker = statusMarker(t, r.word, `ps-st-${r.key}`, { size: ICON.dot });
    return rowStates(h_flex().id(`ps-${r.key}`).h(ROW.two).flex_none().px(SPACE[2]).gap(SPACE[2]).items_center().rounded(RADIUS.md), t, { selected: on, disabled: !live, focused: on, ground: t.popover, color: softInk(t), hoverFill: t.popover })
      .role("list_box_option").accessibility_label(`${r.aria}${on ? ", selected" : ""}`)
      .when(on, el => el.aria_selected(true).aria_active_descendant())
      .when(live, (el) => el.on_click((_e, cx) => this.go(r.key, cx))
        .on_mouse_move((_e, cx) => { if (on) return; this.choice.choose(r.key); cx.notify(); }))
      .child(slot)
      .child(v_flex().flex_1().min_w(0).gap(SPACE.half)
        .child(h_flex().min_w(0).gap(SPACE[2]).items_baseline()
          .child(div().id(`ps-name-${r.key}`).min_w(0).truncate().text_size(TYPE.base).when(!live, (el) => el.text_color(t.dim)).child(r.label))
          .when(Boolean(!r.mark && r.what && r.what !== r.label), (el) => el.child(div().flex_none().text_size(TYPE.xs).text_color(t.muted).child(r.what))))
        .when(Boolean(r.detail), (el) => el.child(div().id(`ps-place-${r.key}`).min_w(0).truncate().text_size(TYPE.xs).text_color(t.dim).child(r.detail))))
      .when(Boolean(marker && STATUS_WORD[r.word]), (el) => el.child(h_flex().flex_none().gap(SPACE.status).items_center().child(marker)
        .child(div().text_size(TYPE.xs).text_color(t.muted).child(STATUS_WORD[r.word]))));
  }

  // The foot's keys (spec §7): the kbd, then its word, 4 px apart; groups 12 apart.
  keys(t, glyphs, words) {
    return h_flex().flex_none().gap(SPACE[1]).items_center().child(kbd(t, glyphs, { ground: t.popover })).child(words);
  }

  render(cx) {
    const t = theme();
    const list = this.list();
    const picks = list.filter((r) => r.command);
    const sel = this.selected(picks);
    // Only the rows in view are drawn, so a long list costs no more than a short one.
    this.top = keepInView(list.length, sel ? list.indexOf(sel) : -1, this.top, SHOWN);
    const shown = list.slice(this.top, this.top + SHOWN);
    const empty = list.length === 0;

    return this.keyed(withFont(v_flex())).id("pdk-search").track_focus(this.handle).w_full().min_h(0).bg(t.popover)
      .role("dialog").accessibility_label("Search")
      // Keys no action took: from the list (pdk-search.focus:list) or falling through the field. Enter only from the
      // list: the field's Enter propagates here and also emits submit, which runs go() (base state.rs:2153-2163).
      .on_key_down((e, cx) => {
        if (e.keystroke === "enter" && !this.handle.is_focused()) return;
        if (this.press(e.keystroke, cx)) cx.stop_propagation();
      })
      // The field: the frame's top row and its Places / Commands switch (Esc is drawn once, in the foot).
      .child(h_flex().h(ROW.two).flex_none().px(PAD).gap(SPACE[2]).items_center().border_b(1).border_color(t.border)
        .child(div().w(MARK).flex_none().flex().justify_center().child(icon("search", ICON.base, t.dim)))
        .child(Input.new(this.input).flex_1().h_full().bg(t.popover).border_0().text_size(TYPE.base).text_color(t.foreground).accessibility_label(this.mode==="commands"?"Search commands":"Search machines, workspaces, tabs, agents and panes"))
        .child(segmentedChoice(t,"search-mode",[{value:"places",label:"Places"},{value:"commands",label:"Commands"}],this.mode,(v,_e,cx)=>this.switchMode(v,cx),{variant:"navigation",ground:t.popover,owner:this}).flex_none()))
      // As tall as what it shows, at most SHOWN entries (Remaining surfaces contract, review UX14): the popup has no
      // height in mod.json, so Herdr sizes it to this content and a one-result list leaves no blank area.
      .child(v_flex().id("pdk-search-list").flex_none().h((empty ? ROW.base : shown.reduce((h, r) => h + (r.head ? ROW.base : ROW.two), 0)) + 2 * SPACE[1]).p(SPACE[1]).overflow_hidden()
        .role("list_box").accessibility_label(empty ? "No matches" : `Results, ${picks.length}`)
        // One step per row of travel, summed so a trackpad's small deltas add up; a turn the other way starts over.
        .on_scroll_wheel((e, cx) => {
          const dy = -e.delta.y;
          if (!dy) return;
          if (Math.sign(dy) !== Math.sign(this.wheel)) this.wheel = 0;
          this.wheel += dy;
          const steps = Math.trunc(this.wheel / ROW.two);
          if (steps) { this.wheel -= steps * ROW.two; this.move(steps, cx); }
        })
        .when(empty,el=>el.child(h_flex().h(ROW.base).px(PAD).gap(SPACE[2]).items_center().child(div().flex_1().text_size(TYPE.sm).text_color(t.muted).child(`Nothing matches “${this.query}”`)).child(textButton(t,"search-clear","Clear filter","Clear filter",(_e,cx)=>this.setQuery(this.mode==="commands"?">":"",cx),{h:ROW.compact}))))
        .children(shown.map((r) => this.row(t, r, r === sel))))
      // The foot (36): ↑↓ Navigate, ↵ Open, Esc Clear (with a query) or Close, then ⌥↵ and the Actions of the chosen result.
      .child(h_flex().h(ROW.base + SPACE[2]).flex_none().px(PAD).gap(SPACE[3]).items_center().border_t(1).border_color(t.border).text_size(TYPE.xs).text_color(t.muted)
        .when(this.choice.missing, (el) => el.child(div().flex_1().min_w(0).truncate().child("No longer available")))
        .when(!this.choice.missing, (el) => el.child(this.keys(t, ["↑", "↓"], "Navigate")).child(this.keys(t, ["↵"], "Open")).child(this.keys(t, ["Esc"], this.query ? "Clear" : "Close"))
          .child(this.keys(t, ["⇥"], this.mode === "commands" ? "Places" : "Commands")).child(div().flex_1()))
        .child(h_flex().flex_none().gap(SPACE[1]).items_center().child(kbd(t, ["⌥", "↵"], { ground: t.popover }))
          .child(textButton(t,"search-actions","Actions","Actions",(_e,cx)=>this.actions(cx),{h:ROW.compact,size:TYPE.xs,disabled:!sel?.target}))));
  }
}
