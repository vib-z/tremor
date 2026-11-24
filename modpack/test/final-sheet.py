#!/usr/bin/env python3
"""The final screenshot set's crops and contact sheets (shots-final.sh). Needs Pillow; reads and writes only the
paths it is given.

  final-sheet.py crops <theme dir> <theme>         each manifest.tsv line (name, frame, base, region) -> crops/
  final-sheet.py sheet <out.png> <title> <png>...  a labelled grid of the given images

Regions, in the frame's own 2x pixels: sidebar (the pack layout's 256 px column), tabbar (the strip over the work
area), work (the work area under it), full, and diff: the largest solid area that differs from the base frame
(an overlay), so a spinner, a toast or a redrawn pane border elsewhere does not widen it. A diff with nothing found falls back to work.
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageStat

SIDEBAR = 2 * 256
TABBAR = 2 * 40
BLOCK = 8
PAD = 24


def region(frame, base, kind, still=None):
    w, h = frame.size
    boxes = {"sidebar": (0, 0, SIDEBAR, h), "tabbar": (SIDEBAR, 0, w, TABBAR), "work": (SIDEBAR, TABBAR, w, h), "full": (0, 0, w, h)}
    if kind != "diff":
        return boxes[kind]
    if base is None or base.size != frame.size:
        return boxes["work"]
    # What changed between two base frames shot back to back (a spinner, a clock) is animation, not the overlay.
    moving = None
    if still is not None and still.size == frame.size:
        moving = ImageChops.difference(base, still).convert("L").point(lambda v: 255 if v > 24 else 0).filter(ImageFilter.MaxFilter(17))
    # A dialog dims the whole window behind it: dim the base by as much first. It is read in the top-left corner on a
    # light theme; a dark corner can't show it (black dimmed is black), so on a dark one it is the median ratio of lit
    # pixels (labels) in the sidebar and in the tab strip, and the window is dimmed only when both are: a centred
    # dialog covers neither, while a popover covers at most one of them (review S1, design-final-look E1).
    corner = (0, 0, 64, 64)
    lit = ImageStat.Stat(base.crop(corner).convert("L")).mean[0]

    def ratio(box):
        r = sorted(f / b for b, f in zip(base.crop(box).convert("L").getdata(), frame.crop(box).convert("L").getdata()) if b > 48)
        return r[len(r) // 2] if len(r) > 500 else 1

    if lit > 64:
        k = ImageStat.Stat(frame.crop(corner).convert("L")).mean[0] / lit
    else:
        k = max(ratio(boxes["sidebar"]), ratio(boxes["tabbar"]))
    dimmed = k < 0.9
    if dimmed:
        base = ImageEnhance.Brightness(base).enhance(k)
    # On a dimmed dark window a dialog's own ground is only a little lighter than the dimmed ground behind it, so the
    # change that counts is smaller there; elsewhere it stays at 24, above antialiasing and a redrawn border.
    edge = 10 if dimmed and lit <= 64 else 24
    mask = ImageChops.difference(frame, base).convert("L").point(lambda v: 255 if v > edge else 0)
    if moving is not None:
        mask = ImageChops.subtract(mask, moving)
    blocks = mask.resize((w // BLOCK, h // BLOCK), Image.BOX).point(lambda v: 255 if v else 0)
    bw, bh = blocks.size
    # Close (a menu's text rows on the same ground become one area), then open (a pane's 1 px border, redrawn when an
    # overlay takes focus, and a spinner drop out), on a blank margin so a line by the window's edge is thin too.
    m = 8
    small = Image.new("L", (bw + 2 * m, bh + 2 * m), 0)
    small.paste(blocks, (m, m))
    small = small.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
    small = small.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).crop((m, m, m + bw, m + bh))
    on = [v > 0 for v in small.getdata()]
    seen = [False] * len(on)
    best = None
    for start, hit in enumerate(on):
        if not hit or seen[start]:
            continue
        seen[start] = True
        stack, n = [start], 0
        x0 = x1 = start % bw
        y0 = y1 = start // bw
        while stack:
            i = stack.pop()
            n += 1
            x, y = i % bw, i // bw
            x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    j = ny * bw + nx
                    if 0 <= nx < bw and 0 <= ny < bh and on[j] and not seen[j]:
                        seen[j] = True
                        stack.append(j)
        if best is None or n > best[0]:
            best = (n, x0, y0, x1, y1)
    if best is None:
        return boxes["work"]
    _, x0, y0, x1, y1 = best
    return (max(0, x0 * BLOCK - PAD), max(0, y0 * BLOCK - PAD), min(w, (x1 + 1) * BLOCK + PAD), min(h, (y1 + 1) * BLOCK + PAD))


def crops(theme_dir, theme):
    out = os.path.join(theme_dir, "crops")
    os.makedirs(out, exist_ok=True)
    for line in open(os.path.join(theme_dir, "manifest.tsv")):
        name, frame, base, kind = line.rstrip("\n").split("\t")
        im = Image.open(frame).convert("RGB")
        bases = [Image.open(b).convert("RGB") for b in base.split(",") if b != "-"]
        path = os.path.join(out, f"{name}-{theme}-2x.png")
        base, still = (bases + [None, None])[:2]
        im.crop(region(im, base, kind, still)).save(path)
        print(path)


def sheet(out, title, files, cell=(720, 450), cols=4):
    label = 28
    rows = (len(files) + cols - 1) // cols
    W, H = cols * (cell[0] + 16) + 16, 56 + rows * (cell[1] + label + 16)
    o = Image.new("RGB", (W, H), (128, 128, 128))
    d = ImageDraw.Draw(o)
    d.text((16, 16), title, fill=(255, 255, 255))
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB")
        im.thumbnail(cell, Image.LANCZOS)
        x, y = 16 + (i % cols) * (cell[0] + 16), 56 + (i // cols) * (cell[1] + label + 16)
        o.paste(im, (x, y))
        d.text((x, y + cell[1] + 6), os.path.basename(f).rsplit(".", 1)[0], fill=(255, 255, 255))
    o.save(out)
    print(out)


if __name__ == "__main__":
    if sys.argv[1] == "crops":
        crops(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "sheet":
        cols = 6 if len(sys.argv) - 4 > 16 else 4
        sheet(sys.argv[2], sys.argv[3], sys.argv[4:], cols=cols)
    else:
        sys.exit("usage: final-sheet.py crops <theme dir> <theme> | sheet <out.png> <title> <png>...")
