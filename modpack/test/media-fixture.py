#!/usr/bin/env python3
"""FIXTURES, not captures: builds the media lane's test media and two transcripts that name them.

  media-fixture.py MEDIA_DIR CLAUDE_OUT CODEX_OUT [CWD]

MEDIA_DIR gets images drawn here (PNG, stdlib only; a JPEG through macOS sips), a one-page PDF and an HTML
page written by hand, a 4-second clip from ffmpeg's test pattern when ffmpeg is installed, a 26 MB image (the
large-file case) and a 2.5 MB one pasted inline (the large inline case). Nothing is downloaded.

CLAUDE_OUT and CODEX_OUT are built from the verified samples (docs/modpack/research/fixtures, captured from
Claude Code 2.1.319 and codex-cli 0.167.0): their own lines first, then records of the same shapes (envelope
fields copied from the sample's records, new ids) that carry media the way each format does: a pasted image
block, a Read of an image, a command that writes a video, Markdown and HTML images, a PDF and an HTML link, a
remote image URL, a missing file, Codex local_image and data-URL parts and an ImageView item.
"""
import base64
import json
import os
import random
import shutil
import struct
import subprocess
import sys
import uuid
import zlib

HERE = os.path.dirname(os.path.realpath(__file__))
SAMPLES = os.path.join(HERE, "..", "..", "docs", "modpack", "research", "fixtures")
CLAUDE_SAMPLE = os.path.join(SAMPLES, "claude-code", "haiku-two-files.jsonl")
CODEX_SAMPLE = os.path.join(SAMPLES, "codex", "rollout-luna-two-files.jsonl")


def png(path, w, h, pixel=None, level=6, rows=None):
    """A truecolour PNG: pixel(x, y) -> (r, g, b), or rows(y) -> bytes of one row."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rows(y) if rows else bytes(c for x in range(w) for c in pixel(x, y))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(raw), level)) + chunk(b"IEND", b""))


def gradient(w, h, a, b):
    def row(y):
        out = bytearray()
        for x in range(w):
            t = (x + y) / (w + h)
            grid = 40 if (x % 100 < 2 or y % 100 < 2) else 0
            out += bytes(min(255, int(a[i] + (b[i] - a[i]) * t) + grid) for i in range(3))
        return bytes(out)
    return row


def chart(w, h):
    bars = [0.35, 0.62, 0.48, 0.81, 0.57, 0.92]
    colors = [(76, 110, 245), (32, 201, 151), (250, 176, 5), (240, 101, 149), (121, 80, 242), (21, 170, 191)]
    bw = w // (len(bars) * 2 + 1)
    def row(y):
        out = bytearray()
        for x in range(w):
            i, inside = divmod(x - bw, bw * 2)
            c = (248, 249, 250)
            if 0 <= i < len(bars) and x >= bw and inside < bw and y > h - 40 - bars[i] * (h - 120):
                c = colors[i]
            if y in (h - 40, h - 39):
                c = (73, 80, 87)
            out += bytes(c)
        return bytes(out)
    return row


def noise(w, h, seed):
    rnd = random.Random(seed)
    return lambda y: bytes(rnd.getrandbits(8) for _ in range(w * 3))


def pdf(path):
    stream = (b"BT /F1 32 Tf 72 700 Td (Quarterly report - media fixture) Tj ET\n"
              b"BT /F1 16 Tf 72 664 Td (A one-page PDF written by hand for the chat preview test.) Tj ET\n"
              b"0.30 0.43 0.96 rg 72 380 90 220 re f 0.13 0.79 0.59 rg 182 380 90 160 re f\n"
              b"0.98 0.69 0.02 rg 292 380 90 260 re f 0.94 0.40 0.58 rg 402 380 90 120 re f\n")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    open(path, "wb").write(out)


def make_media(d):
    os.makedirs(d, exist_ok=True)
    j = lambda n: os.path.join(d, n)
    png(j("mock.png"), 1200, 800, rows=gradient(1200, 800, (233, 236, 239), (165, 216, 255)))
    png(j("shot-wide.png"), 1600, 1000, rows=gradient(1600, 1000, (34, 139, 230), (190, 75, 219)))
    png(j("chart.png"), 1400, 900, rows=chart(1400, 900))
    png(j("square.png"), 800, 800, rows=gradient(800, 800, (255, 212, 59), (255, 107, 107)))
    png(j("tall.png"), 800, 1200, rows=gradient(800, 1200, (18, 184, 134), (34, 139, 230)))
    subprocess.run(["/usr/bin/sips", "-s", "format", "jpeg", j("tall.png"), "--out", j("tall.jpg")], capture_output=True, check=True)
    os.remove(j("tall.png"))
    png(j("small.png"), 96, 64, rows=gradient(96, 64, (250, 82, 82), (76, 110, 245)))
    png(j("pasted-large.png"), 1000, 860, rows=noise(1000, 860, 7), level=0)
    if not os.path.exists(j("huge-scan.png")):
        png(j("huge-scan.png"), 3000, 3000, rows=noise(3000, 3000, 11), level=0)
    pdf(j("report.pdf"))
    with open(j("page.html"), "w") as f:
        f.write('<!doctype html><html><head><meta charset="utf-8"><title>Media fixture</title></head>\n'
                "<body><h1>Media fixture</h1><p>An HTML page named in a test transcript. No scripts, no remote resources.</p></body></html>\n")
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg and not os.path.exists(j("clip.mp4")):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25",
                        "-t", "4", "-pix_fmt", "yuv420p", "-c:v", "libx264", j("clip.mp4")], check=True)
    for gone in ("missing-frame.png",):
        if os.path.exists(j(gone)):
            os.remove(j(gone))


def b64(path):
    return base64.b64encode(open(path, "rb").read()).decode()


def claude(d, out, cwd):
    lines = open(CLAUDE_SAMPLE).read().splitlines()
    recs = [json.loads(l) for l in lines]
    user = next(r for r in recs if r.get("type") == "user" and isinstance(r["message"]["content"], str))
    asst = next(r for r in recs if r.get("type") == "assistant" and r["message"]["content"][0].get("type") == "text")
    result = next(r for r in recs if r.get("type") == "user" and isinstance(r["message"]["content"], list) and not r.get("toolDenialKind"))
    session = user["sessionId"]
    last = [recs[-1].get("uuid") or asst["uuid"]]
    t = [0]

    def stamp(r):
        t[0] += 1
        r.update(uuid=str(uuid.uuid4()), parentUuid=last[0], timestamp=f"2026-11-09T09:{10 + t[0]:02d}:00.000Z", cwd=cwd, sessionId=session)
        last[0] = r["uuid"]
        return r

    def prompt(content):
        r = json.loads(json.dumps(user))
        r["message"] = {"role": "user", "content": content}
        return stamp(r)

    def say(blocks):
        r = json.loads(json.dumps(asst))
        r["message"] = {**r["message"], "id": "msg_" + uuid.uuid4().hex[:24], "content": blocks}
        return stamp(r)

    def tool_result(tid, content, extra=None):
        r = json.loads(json.dumps(result))
        r["message"] = {"role": "user", "content": [{"tool_use_id": tid, "type": "tool_result", "content": content, "is_error": False}]}
        r["toolUseResult"] = extra or {"stdout": "", "stderr": "", "interrupted": False, "isImage": False}
        return stamp(r)

    m = lambda n: os.path.join(d, n)
    new = [
        prompt([{"type": "text", "text": "[Image #1] This is the full-size screen I am working from."},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64(m("pasted-large.png"))}}]),
        prompt(f"Turn the mock at {m('mock.png')} into a chart, a short clip and a one-page report. Keep everything in {d}."),
        prompt([{"type": "text", "text": "[Image #2] Use this palette."},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64(m("small.png"))}}]),
        say([{"type": "tool_use", "id": "toolu_media_read", "name": "Read", "input": {"file_path": m("shot-wide.png")}}]),
        tool_result("toolu_media_read", [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64(m("small.png"))}}],
                    {"type": "image", "file": {"type": "image/png", "originalSize": os.path.getsize(m("shot-wide.png"))}}),
        say([{"type": "tool_use", "id": "toolu_media_clip", "name": "Bash",
              "input": {"command": f"ffmpeg -f lavfi -i testsrc2 -t 4 {m('clip.mp4')}", "description": "Render a 4 second clip"}}]),
        tool_result("toolu_media_clip", "done"),
        say([{"type": "text", "text": (
            f"Here is the chart:\n\n![Chart]({m('chart.png')})\n\n"
            f"The clip is at {m('clip.mp4')}, the report at {m('report.pdf')} and a page at {m('page.html')}. "
            "A reference photo from the brief: https://images.example.com/photos/reference.jpg\n\n"
            f"The scan {m('huge-scan.png')} is large. I also looked for {m('missing-frame.png')}, but it is not there.")}]),
    ]
    with open(out, "w") as f:
        for l in lines:
            f.write(l + "\n")
        for r in new:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")


def codex(d, out, cwd, thread):
    lines = open(CODEX_SAMPLE).read().splitlines()
    recs = [json.loads(l) for l in lines]
    first = recs[0]
    first["payload"]["id"] = first["payload"]["session_id"] = thread
    first["payload"]["cwd"] = cwd
    lines[0] = json.dumps(first, separators=(",", ":"))
    um = next(r for r in recs if r["type"] == "event_msg" and r["payload"].get("item", {}).get("type") == "UserMessage")
    turn = "01a1bd47-media-7c93-a644-861a80701eb6"
    n = [len(recs)]

    def item(it):
        r = json.loads(json.dumps(um))
        n[0] += 1
        r.update(ordinal=n[0], timestamp=f"2026-11-09T09:30:{n[0] % 60:02d}.000Z")
        r["payload"] = {**r["payload"], "thread_id": thread, "turn_id": turn, "item": it}
        return r

    m = lambda name: os.path.join(d, name)
    small = "data:image/png;base64," + b64(m("small.png"))
    new = [
        item({"type": "UserMessage", "id": str(uuid.uuid4()), "content": [
            {"type": "local_image", "path": m("tall.jpg")},
            {"type": "image", "image_url": small},
            {"type": "text", "text": "[Image #1] [Image #2] Crop the first to a square, in the second one's colours.", "text_elements": []}]}),
        item({"type": "ImageView", "id": "view-1", "path": m("tall.jpg")}),
        item({"type": "CommandExecution", "id": "exec-media-1", "process_id": "4242",
              "command": ["/bin/zsh", "-lc", f"sips -c 800 800 {m('tall.jpg')} --out {m('square.png')}"],
              "cwd": "file://" + cwd, "source": "unified_exec_startup", "status": "completed",
              "aggregated_output": f"{m('tall.jpg')}\n  {m('square.png')}\n", "exit_code": 0}),
        item({"type": "AgentMessage", "id": "msg_media_final", "content": [{"type": "Text", "text":
              f"Saved the square crop to {m('square.png')}. The preview clip is {m('clip.mp4')}."}], "phase": "final_answer"}),
    ]
    done = json.loads(lines[-1])
    done["payload"] = {**done["payload"], "turn_id": turn, "root_turn_id": turn}
    with open(out, "w") as f:
        for l in lines:
            f.write(l + "\n")
        for r in new:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")
        f.write(json.dumps(done, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    media_dir, claude_out, codex_out = sys.argv[1:4]
    cwd = sys.argv[4] if len(sys.argv) > 4 else media_dir
    thread = os.environ.get("PDK_FIXTURE_THREAD", "01a1bd47-5fc4-76f0-926e-e081542198de")
    make_media(media_dir)
    for p in (claude_out, codex_out):
        os.makedirs(os.path.dirname(p), exist_ok=True)
    claude(media_dir, claude_out, cwd)
    codex(media_dir, codex_out, cwd, thread)
    print(json.dumps({"media": sorted(os.listdir(media_dir)), "claude": claude_out, "codex": codex_out}))
