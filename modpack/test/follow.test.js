// Review R9: following a tall thread must stay at its end however many follow requests come in a row. The chat's
// list handle's scroll_to_bottom() reveals the list's last item (gpui-kit base virtual_list.rs:123-125, Top), by
// the rule at :295-299, then clamps the offset (:650-655). That rule is written here as a pure function and run on
// the sizes the chat gives its list (adapters/tail.js listSizes). So is the list's visible range (:387-411), which
// tells the chat whether the newest row is in view (rangeAtEnd), and so when following starts again (followAfter).
import { test, expect } from "bun:test";
import { listSizes, END_GAP, rangeAtEnd, followAfter } from "../adapters/tail.js";

// One request to reveal item `i` from offset `off` (0 at the top, negative further down) in a view `view` tall.
function reveal(off, sizes, i, view) {
  const top = sizes.slice(0, i).reduce((a, b) => a + b, 0), bottom = top + sizes[i];
  if (top + off < 0) off = -top;
  else if (bottom + off > view) off = view - bottom;
  const content = sizes.reduce((a, b) => a + b, 0);
  return Math.min(0, Math.max(view - content, off)) || 0; // no -0
}
const follow = (off, sizes, view) => reveal(off, sizes, sizes.length - 1, view);
// The items drawn at offset `off`: those crossing the viewport, and two past the last one ending inside it.
function visibleRange(off, sizes, view) {
  const origins = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
  const endsBefore = (edge) => { let i = 0; while (i < sizes.length && origins[i] + sizes[i] <= edge) i++; return i; };
  const first = endsBefore(-off), past = endsBefore(-off + view);
  const last = past === sizes.length ? sizes.length : Math.min(past + 2, sizes.length);
  return { start: first, end: Math.max(last, first) };
}
const VIEW = 600, THREAD = 3 * VIEW;

test("R9: the app's reveal rule flips a single item taller than the view between its top and its end", () => {
  const one = [THREAD];
  const offs = [];
  let off = -(THREAD - VIEW);
  for (let i = 0; i < 4; i++) offs.push((off = follow(off, one, VIEW)));
  expect(offs).toEqual([0, -1200, 0, -1200]); // why 76cf6b4's one-item list jumped to the top every other render
});

test("the list is the thread, a fixed 20 px end gap and a 0 px end mark, whatever the composer's height", () => {
  expect(END_GAP).toBe(20);
  expect(listSizes(VIEW, THREAD)).toEqual([THREAD, 20, 0]);
  expect(listSizes(VIEW, 1799.2)).toEqual([1800, 20, 0]);
  // A short thread fills the view less the gap, so its rows sit at the bottom.
  expect(listSizes(VIEW, 200)).toEqual([580, 20, 0]);
});

test("R9: six follow requests in a row, one from the top and one from the middle all end at the end", () => {
  const sizes = listSizes(VIEW, THREAD);
  const end = VIEW - sizes.reduce((a, b) => a + b, 0);
  let off = end;
  for (let i = 0; i < 6; i++) { off = follow(off, sizes, VIEW); expect(off).toBe(end); }
  let top = 0, mid = Math.round(end / 2);
  for (let i = 0; i < 6; i++) { top = follow(top, sizes, VIEW); mid = follow(mid, sizes, VIEW); expect([top, mid]).toEqual([end, end]); }
  // At the end the thread's last px sits 20 px above the view's bottom: the gap, above the composer.
  expect(sizes[0] + end).toBe(VIEW - END_GAP);
  // A short thread fills the view (its rows at the bottom) and never scrolls.
  const short = listSizes(VIEW, 200);
  expect(short.reduce((a, b) => a + b, 0)).toBe(VIEW);
  expect(follow(0, short, VIEW)).toBe(0);
});

test("the drawn range says when the newest row is in view: at the end, inside the gap, and 21 px up", () => {
  const sizes = listSizes(VIEW, THREAD);
  const end = VIEW - sizes.reduce((a, b) => a + b, 0);
  expect(visibleRange(end, sizes, VIEW)).toEqual({ start: 0, end: 3 });
  expect(rangeAtEnd(visibleRange(end, sizes, VIEW))).toBe(true);
  expect(rangeAtEnd(visibleRange(end + 10, sizes, VIEW))).toBe(true); // inside the gap: the newest row still shows
  expect(visibleRange(end + 21, sizes, VIEW)).toEqual({ start: 0, end: 2 });
  expect(rangeAtEnd(visibleRange(end + 21, sizes, VIEW))).toBe(false);
  expect(rangeAtEnd(visibleRange(0, sizes, VIEW))).toBe(false); // the top
  expect(rangeAtEnd({ start: 0, end: 1 })).toBe(null); // the list measuring item 0 alone says nothing
  // A short thread is always at its end.
  expect(rangeAtEnd(visibleRange(0, listSizes(VIEW, 200), VIEW))).toBe(true);
});

test("following: stops only when the reader scrolls away; starts again when the end comes back into view", () => {
  const f = (follow, atEnd, wasAtEnd, scrolled) => followAfter(follow, { atEnd, wasAtEnd, scrolled });
  // A measuring call changes nothing.
  expect([f(true, null, true, true), f(false, null, false, true)]).toEqual([true, false]);
  // Following: at the end it stays on; a layout pass that lags (not at the end, no scroll) keeps it on.
  expect(f(true, true, true, false)).toBe(true);
  expect(f(true, false, true, false)).toBe(true);
  // The reader scrolls the end out of view (either direction of wheel): it stops.
  expect(f(true, false, true, true)).toBe(false);
  // Stopped, reading up the thread: it stays stopped.
  expect(f(false, false, false, true)).toBe(false);
  expect(f(false, false, false, false)).toBe(false);
  // Scrolled back down to the end: it starts again.
  expect(f(false, true, false, true)).toBe(true);
  // The end came back into view by itself (the thread shrank, the view grew): it starts again.
  expect(f(false, true, false, false)).toBe(true);
  // A call opened at the end stops following (read) and holds: nothing scrolled, the end was already in view.
  expect(f(false, true, true, false)).toBe(false);
  // ...until the reader scrolls while the end is in view.
  expect(f(false, true, true, true)).toBe(true);
});
