#!/usr/bin/env python3
"""fake-agent.py with a status message: the Map's hubs show an agent's own line (unit.msg), which fake-agent only
sends while blocked. `--pdk-msg <text>` sets the line every report carries; a control line `msg <text>` changes it.
Everything else is fake-agent.py unchanged (no model, no tools)."""
import importlib.util
import os
import sys

spec = importlib.util.spec_from_file_location("fake_agent", os.path.join(os.path.dirname(os.path.realpath(__file__)), "fake-agent.py"))
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)

line = {"msg": ""}
if "--pdk-msg" in sys.argv:
    i = sys.argv.index("--pdk-msg")
    line["msg"] = sys.argv[i + 1]
    del sys.argv[i:i + 2]

report = fa.report
fa.report = lambda state, app, title="", msg="", kind="", rid="": report(
    state, app, title, msg or ("" if rid or state == "clear" else line["msg"]), kind, rid)

apply = fa.apply


def apply_msg(cmd, app, title, name, as_kind):
    if cmd.startswith("msg "):
        line["msg"] = cmd[4:]
        return
    apply(cmd, app, title, name, as_kind)


fa.apply = apply_msg

if __name__ == "__main__":
    fa.main()
