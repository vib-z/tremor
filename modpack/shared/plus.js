// The contract's "+" (visual contract, Section + `.plus`): a 24 by 24 ghost-muted target with the + button's 4 px corner;
// muted, foreground on hover, selected when pressed (shared button). The sidebar's Workspaces + and the tab bar's +
// (review UX12). The glyph is the 14 px Lucide plus, as stock Herdr and the sidebar's other 24 px buttons draw theirs:
// the contract's text "+" (22/400 on a 20 line) sat 4.5 px below the box's middle (measured 11 Nov).
// ponytail: here until build-foot takes it into shared/ui.js (asked in questions/build-tree.md).
import { button, RADIUS } from "./ui.js";

export const plusButton = (t, id, label, onPress) =>
  button(t, id, { icon: "plus", label, variant: "ghost-muted", size: "xs", onPress }).rounded(RADIUS.sm);
