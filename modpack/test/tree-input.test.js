import { test, expect } from 'bun:test';
import { harness, world } from './parity-harness.js';

test('clicking a workspace caret selects its row for subsequent arrow keys', async () => {
  const h = harness(world()), tree = new h.Tree();
  tree.init({}, h.cx); h.tasks.length = 0;
  tree.render(h.cx); await h.flushRows(tree);
  h.byId('sp:R-fold').props.on_click({ click_count: 1 }, h.cx);
  expect(tree.folded.has('sp:R')).toBe(true);
  expect(tree.sel).toBe('sp:R');
  tree.render(h.cx);
  h.byId('pdk-tree').props.on_key_down({ key: 'right' }, h.cx);
  expect(tree.folded.has('sp:R')).toBe(false);
  expect(tree.folded.has('sp:A')).toBe(false);
});

test('Left and Right are bound to actions inside the tree context', async () => {
  const h = harness(world()), tree = new h.Tree();
  tree.init({}, h.cx); tree.render(h.cx); await h.flushRows(tree);
  const root = h.byId('pdk-tree'), context = root.props.key_context;
  expect(typeof context).toBe('string');
  for (const keystroke of ['left', 'right']) {
    const binding = h.bindings.find(b => b.keystroke === keystroke && b.context === context);
    expect(binding).toBeDefined();
    tree.sel = 'sp:R';
    root.props[`on_action:${binding.action}`]({}, h.cx);
    expect(tree.folded.has('sp:R')).toBe(keystroke === 'left');
  }
});

const setup = async (w = world()) => {
  const h = harness(w), tree = new h.Tree();
  tree.init({}, h.cx); h.tasks.length = 0;
  tree.render(h.cx); await h.flushRows(tree);
  const draw = () => { tree.render(h.cx); for (const v of tree.rowViews.values()) v.render(); };
  const action = (key) => { const root = h.byId('pdk-tree'); const b = h.bindings.find(x => x.keystroke === key && x.context === root.props.key_context); root.props[`on_action:${b.action}`]({ action: b.action }, h.cx); draw(); };
  return { h, tree, draw, action };
};

test('a caret click folds once, stops at the caret and gives its row the tree focus', async () => {
  const { h, tree, draw } = await setup();
  let stops = 0; const cx = { ...h.cx, stop_propagation: () => { stops++; } };
  h.byId('sp:B-fold').props.on_click({ click_count: 1 }, cx); draw();
  expect([tree.folded.has('sp:B'), tree.sel, tree.handle.is_focused(), stops]).toEqual([true, 'sp:B', true, 1]);
  // Enter on the focused caret: the same one fold, the key kept at the caret.
  h.byId('sp:B-fold').props.on_key_down({ key: 'enter' }, cx); draw();
  expect([tree.folded.has('sp:B'), stops]).toEqual([false, 2]);
});

test('Left closes and Right opens only the selected workspace, and repeating either changes nothing', async () => {
  const { h, tree, draw, action } = await setup();
  h.byId('sp:B-fold').props.on_click({ click_count: 1 }, h.cx); draw(); // B folded, selected
  action('right'); action('right');
  expect([tree.folded.has('sp:B'), tree.folded.has('sp:A'), tree.folded.has('sp:R')]).toEqual([false, false, false]);
  action('left'); action('left');
  expect([tree.folded.has('sp:B'), tree.folded.has('sp:A'), tree.folded.has('sp:R')]).toEqual([true, false, false]);
  expect(tree.sel).toBe('sp:B');
  // The on_key_down fallback, for a host that refused the bindings, does the same.
  h.byId('pdk-tree').props.on_key_down({ key: 'right' }, h.cx); draw();
  expect(tree.folded.has('sp:B')).toBe(false);
});

test('with no row chosen yet, Left or Right chooses one and folds nothing', async () => {
  const { tree, action } = await setup();
  action('left');
  expect([tree.sel, tree.folded.size]).toEqual(['sp:A', 0]);
});

test('a workspace row click folds it and gives it the tree focus', async () => {
  const { h, tree, draw } = await setup();
  h.byId('sp:R').props.on_click({ click_count: 1 }, h.cx); draw();
  expect([tree.folded.has('sp:R'), tree.sel, tree.handle.is_focused()]).toEqual([true, 'sp:R', true]);
});

test('the arrows stay the rename field\'s and the machine menu\'s while those are open', async () => {
  const { h, tree, draw } = await setup();
  expect(h.byId('pdk-tree').props.key_context).toBe('PdkTree');
  tree.startRename(tree.list.find(r => r.key === 'sp:A'), h.cx); draw();
  expect(h.byId('pdk-tree').props.key_context).toBeUndefined();
  tree.endRename(false, h.cx); draw();
  expect(h.byId('pdk-tree').props.key_context).toBe('PdkTree');
  tree.machineMenu = true; draw();
  expect(h.byId('pdk-tree').props.key_context).toBeUndefined();
});
