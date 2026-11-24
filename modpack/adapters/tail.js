// Which timeline rows the chat draws so its newest one is in view. A scroll container in this app always starts at
// its top (gpui div.rs:2474-2485: the offset runs from 0 down to minus its overflow) and a mod can move only a
// virtual list's scroll (gpui-kit shell materialize.rs:3520-3527, typings.rs:1700-1709), which cannot hold the chat's
// clickable rows. So a chat longer than its pane opened at its first message and hid every new one below the fold
// (qa-modpack's Hermes live-tail failure). Instead it draws the newest rows that fit, from estimated heights, and
// offers the earlier ones above. Estimates err tall: at worst there is room left above, never a newest row below.

const LINE = 22; // chat body line height (TYPE.md with 22px lines)
const CHAR = 8.4; // wider than the body font's average character, so lines are over-counted
const GAP = 14; // between rows
const TILE_ROW = 186; // a strip of media tiles, caption included, and its gap
const TILE_W = 248;

const linesOf = (text, perLine) => String(text ?? "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
const tiles = (media, column) => (media?.length ? Math.ceil(media.length / Math.max(1, Math.floor(column / TILE_W))) * TILE_ROW : 0);

// The height one row will take, in px, at a timeline column `column` px wide. Pure.
export function rowHeight(r, column) {
  const perLine = Math.max(10, Math.floor(column / CHAR));
  if (r.type === "user") return (r.text ? linesOf(r.text, Math.floor(perLine * 0.8)) * LINE + 22 : 0) + (r.claimedFrom ? 18 : 0) + tiles(r.media, column);
  if (r.type === "assistant") {
    const paragraphs = String(r.text ?? "").split(/\n\s*\n/).length;
    return linesOf(r.text, perLine) * LINE + paragraphs * 10 + tiles(r.media, column - 26);
  }
  if (r.type === "work") {
    // Drawn open (the worst case): a header, one line per step, each step's own tiles.
    return 24 + (r.items ?? []).reduce((h, i) => h + 26 + tiles(i.media, column - 26), 0);
  }
  return LINE; // a notice
}

// The index of the first row to draw: the newest rows whose heights fit in `height`, always at least the newest one.
// `extra(row)`: px a row takes beyond its estimate, such as the code views open in it.
export function tailStart(rows, { column, height, extra = () => 0 }) {
  let used = 0;
  let i = rows.length;
  while (i > 0) {
    const h = rowHeight(rows[i - 1], column) + extra(rows[i - 1]) + GAP;
    if (i < rows.length && used + h > height) break;
    used += h;
    i--;
  }
  return i;
}

// The chat's list (R9): the thread, the 20 px end gap, then a 0 px end mark. The composer sits under the list, not
// over it, so the gap is all that follows the newest row. Following asks the list to reveal its last item; one that fits
// is bottom-aligned once and then left alone, so repeated requests stay at the end (a single item taller than the view
// flips between its top and end). The thread item is at least the view less the gap, so a short chat fills the view
// with its rows at the bottom. The mark tells the chat when the newest row is in view (rangeAtEnd).
export const END_GAP = 20;
export function listSizes(view, thread) {
  return [Math.max(view - END_GAP, Math.ceil(thread)), END_GAP, 0];
}

// Whether the list's drawn range shows the thread's end. The list draws up to two items past the last one ending inside
// the view (gpui-kit base virtual_list.rs:387-411), so the end mark (index 2) is drawn exactly when the view's bottom
// has reached the thread's end. null for the call that measures item 0 alone (:324-325): it says nothing.
export function rangeAtEnd(range) {
  if (range.end < 2) return null;
  return range.end === 3;
}

// Following after a frame placed the list. It stays on while the end is in view or nothing was scrolled (a layout pass
// that lags never stops it); stopped, it starts again when the end comes back into view, or when the reader scrolls
// while it is in view. Where the list is decides, never which way the wheel turned.
export function followAfter(follow, { atEnd, wasAtEnd, scrolled }) {
  if (atEnd == null) return follow;
  if (follow) return atEnd || !scrolled;
  return atEnd && (!wasAtEnd || scrolled);
}
