#!/usr/bin/env python3
# Draws backgrounds/busy.png, the pack's own busy backdrop for the glass sidebar (owner request 2, 17:37):
# diagonal bands, discs and rings in twelve colours. Generated here, no source image; the pack's own work.
#
# An indexed PNG (colour type 3), so every colour on it is in its palette, and every palette channel is within
# 0x40..0xc0: adapters/tokens.js BACKDROP names those bounds, and the glass contrast test reads the palette.
#   python3 -I modpack/backgrounds/make-busy.py
import random, struct, zlib, os

W, H = 1600, 1000
PALETTE = [
    (0xc0, 0x40, 0x40), (0x40, 0xa8, 0x50), (0x40, 0x60, 0xc0), (0xc0, 0xa0, 0x40),
    (0xa0, 0x40, 0xc0), (0x40, 0xb0, 0xc0), (0xc0, 0x70, 0x40), (0x60, 0x40, 0xa0),
    (0x80, 0xc0, 0x60), (0xc0, 0x60, 0x90), (0x40, 0x48, 0x58), (0xb8, 0xb8, 0xb0),
]
rnd = random.Random(1737)

# Diagonal bands: one long row of colour indices, shifted one step per row.
band = bytearray()
while len(band) < W + H + 200:
    band += bytes([rnd.randrange(len(PALETTE))]) * rnd.randrange(30, 140)
rows = [bytearray(band[y:y + W]) for y in range(H)]

def disc(cx, cy, r, c, hole=0):
    for y in range(max(0, cy - r), min(H, cy + r + 1)):
        dy = y - cy
        dx = int((r * r - dy * dy) ** 0.5)
        if hole and abs(dy) < hole:
            ix = int((hole * hole - dy * dy) ** 0.5)
            for a, b in ((cx - dx, cx - ix), (cx + ix, cx + dx)):
                a, b = max(0, a), min(W, b)
                if a < b: rows[y][a:b] = bytes([c]) * (b - a)
            continue
        a, b = max(0, cx - dx), min(W, cx + dx)
        if a < b: rows[y][a:b] = bytes([c]) * (b - a)

for _ in range(70):
    r = rnd.randrange(20, 170)
    disc(rnd.randrange(W), rnd.randrange(H), r, rnd.randrange(len(PALETTE)), hole=rnd.choice([0, 0, r * 2 // 3]))

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

raw = b"".join(b"\x00" + bytes(r) for r in rows)
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 3, 0, 0, 0))
       + chunk(b"PLTE", b"".join(bytes(c) for c in PALETTE))
       + chunk(b"IDAT", zlib.compress(raw, 9))
       + chunk(b"IEND", b""))
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "busy.png")
open(out, "wb").write(png)
print(out, len(png), "bytes")
