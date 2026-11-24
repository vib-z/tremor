// The host's rules for contexts and redraws, on top of the recording renderer (parity-harness.js). Measured in the
// running app (Herdr 0.1.15, gpui-shell 0.7.1) on 13 Nov 2026 and read in gpui-shell's source; the plain harness hands
// every view one shared `cx`, so it cannot see any of them.
//
//  1. init's `cx` is ambient: `notify()` redraws the view whose call is running. Kept and used inside a row view's
//     handler, it redraws that row, not the tree.
//  2. The `cx` a `cx.spawn` body gets belongs to the view that started the task (or `opts.owner`): `notify()` redraws
//     that view from any call, also after the task has ended.
//  3. `cx.spawn` starts its body at once, inside the call that spawned it. In the render phase `cx.notify()` and
//     `cx.notify(view)` throw; the host logs the rejection ("unhandled rejection in gpui.spawn") and goes on.
//     `await cx.sleep(0)` leaves the render: what follows runs in the task's own call.
//  4. A handler runs in the call of the view whose render registered it.
//  5. A view's render runs again only when that view was asked to redraw. Nothing here redraws the tree on its own:
//     no timers fire, and host data only does through hostChanged().
import { harness } from "./parity-harness.js";

export function hostScope(world) {
  const h = harness(world);
  const stack = [], dirty = new Set(), rejections = [], sleepers = [], owners = new Map();
  const running = () => stack.at(-1) ?? null;
  const call = (view, phase, fn) => { stack.push({ view, phase }); try { return fn(); } finally { stack.pop(); } };
  // `owner`: the view a task's cx belongs to; null for init's and a handler's cx.
  const context = (owner) => {
    // A task resumed after an await runs in its own call, as its owner. Only the tree starts tasks here (a row view
    // has none), so a resumed task whose owner the model lost track of is the tree's.
    const here = () => running() ?? { view: owner ?? root, phase: "task" };
    const allowed = (what) => {
      const at = here();
      if (at.phase === "render") throw new TypeError(`${what} is not allowed during the \`render\` phase; request a re-render from an event handler instead`);
      return at;
    };
    return {
      ...h.cx,
      notify: (target) => { const at = allowed(target ? "cx.notify(entity)" : "cx.notify()"); dirty.add(target ? target.record : owner ?? at.view); },
      new: (Class, props) => make(Class, props).entity,
      spawn: (fn, opts) => {
        const own = opts?.owner === null ? null : opts?.owner ? records.get(opts.owner) : here().view;
        let result;
        try { result = fn(context(own)); } catch (error) { rejections.push(error); return; }
        Promise.resolve(result).catch((error) => rejections.push(error));
      },
      sleep: (ms = 0) => new Promise((resolve) => sleepers.push({ resolve, ms, view: owner ?? here().view })),
      timer: { every: () => {}, after: () => {} },
    };
  };
  const records = new Map(); // view instance -> record
  const make = (Class, props) => {
    const view = new Class(), record = { view, renders: 0, released: false };
    record.entity = { record, set_props: (p) => view.update?.(p), release: () => { record.released = true; dirty.delete(record); return true; }, render: () => draw(record) };
    records.set(view, record);
    call(record, "event", () => view.init?.(props, context(null)));
    dirty.add(record);
    return record;
  };
  const draw = (record) => {
    const from = h.elements.length;
    const out = call(record, "render", () => record.view.render(context(null)));
    for (const el of h.elements.slice(from)) owners.set(el, record);
    record.renders++;
    return out;
  };
  let root = null;
  root = make(h.Tree, {});
  const tree = root.view;
  // The rows the tree's list shows now: its last render's item callback, as the host calls it for a frame.
  const mounted = () => {
    const list = h.elements.findLast((e) => e.props.id === "pdk-tree-list" && owners.get(e) === root)?.props.virtual;
    return list ? list.render({ start: 0, end: list.count }).flatMap((cell) => cell.kids).filter((kid) => kid?.record) : [];
  };
  // One frame: the tree if it was asked to redraw, then each row view the list shows that was asked to.
  const frame = () => {
    const drawn = [];
    if (dirty.delete(root)) { draw(root); drawn.push("tree"); }
    for (const entity of mounted()) if (dirty.delete(entity.record)) { draw(entity.record); drawn.push(keyOf(entity)); }
    return drawn;
  };
  const keyOf = (entity) => [...tree.rowViews].find(([, v]) => v === entity)?.[0] ?? null;
  // Tasks waiting on a short sleep go on, each in its own call.
  const runTasks = async () => {
    await new Promise((r) => setTimeout(r, 0));
    for (const s of sleepers.splice(0).filter((x) => x.ms < 1000)) { stack.push({ view: s.view, phase: "task" }); try { s.resolve(); await new Promise((r) => setTimeout(r, 0)); } finally { stack.pop(); } }
  };
  // Frames and tasks until nothing is left to do.
  const settle = async () => { for (let i = 0; i < 6; i++) { await runTasks(); if (!frame().length && !sleepers.some((x) => x.ms < 1000)) break; } };
  // A handler of the element with that id, in the call of the view that drew it.
  const fire = (id, name, event = {}) => {
    const el = h.elements.findLast((e) => e.props.id === id && owners.has(e));
    if (!el) throw new Error(`no element ${id}`);
    if (typeof el.props[name] !== "function") throw new Error(`${id} has no ${name}`);
    return call(owners.get(el), "event", () => el.props[name](event, context(null)));
  };
  const has = (id, name) => typeof h.elements.findLast((e) => e.props.id === id && owners.has(e))?.props[name] === "function";
  // A pointer click on one element: the press, the release, the click, as far as the element listens to each.
  const click = (id, event = { click_count: 1 }) => { for (const name of ["on_mouse_down:left", "on_mouse_up:left", "on_click"]) if (has(id, name)) fire(id, name, event); };
  return {
    h, tree, root, dirty, rejections, frame, runTasks, settle, fire, click, has,
    // The keys of the rows the list shows now, top to bottom.
    shown: () => mounted().map(keyOf),
    asked: () => [...dirty].map((r) => r === root ? "tree" : keyOf(r.entity)),
    // Host data changed: the host redraws the views that read it (the tree).
    hostChanged: () => dirty.add(root),
    // The host drops the tasks waiting now: they never resume (a task Herdr lost).
    lose: () => sleepers.splice(0).length,
    el: (id) => h.elements.findLast((e) => e.props.id === id && owners.has(e)),
  };
}
