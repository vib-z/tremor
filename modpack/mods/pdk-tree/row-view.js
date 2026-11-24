// Retained native rows: each child owns its render-pass handlers. The virtual list mounts the entity,
// rather than registering callbacks inside an item renderer or reusing an expired Element description.
import { View } from "gpui-kit";
export class TreeRowView extends View {
  init(p) { this.draw = p.draw; }
  update(p) { this.draw = p.draw; }
  render(cx) { return this.draw(cx); }
}
