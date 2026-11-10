"""
Draws the top-down vehicle pictures for the live map (same shapes as the website's
fleet-layer.ts, which draws them on a canvas at run time; the phone has no canvas,
so they are drawn once here and shipped as PNG files).

  python3 scripts/make-map-sprites.py      # writes assets/map/veh-<shape>-<state>[@2x|@3x].png

Shapes point up (north); the map turns them to the vehicle's heading.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "assets" / "map"
W, H, PAD = 26, 52, 6
SS = 4  # supersampling for smooth edges
COLORS = {"moving": "#15803d", "idle": "#b45309", "stopped": "#0369a1", "offline": "#6b7280"}
GLASS = "#0b1b3f"
WHITE = (255, 255, 255, 255)


def draw(shape: str, color: str, scale: int) -> Image.Image:
    k = scale * SS
    size = ((W + PAD * 2) * k, (H + PAD * 2) * k)
    body_layer = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow_layer = Image.new("RGBA", size, (0, 0, 0, 0))
    g = ImageDraw.Draw(body_layer)
    sh = ImageDraw.Draw(shadow_layer)

    def box(x, y, w, h):
        return [(PAD + x) * k, (PAD + y) * k, (PAD + x + w) * k, (PAD + y + h) * k]

    def body(x, y, w, h, r):
        sh.rounded_rectangle(box(x, y + 1.5, w, h), radius=r * k, fill=(10, 20, 45, 110))
        g.rounded_rectangle(box(x, y, w, h), radius=r * k, fill=color, outline=WHITE, width=max(1, round(1.6 * k)))

    def pane(x, y, w, h, r, fill=GLASS):
        g.rounded_rectangle(box(x, y, w, h), radius=r * k, fill=fill)

    def ribs(ys):
        for y in ys:
            g.line([(PAD + 6) * k, (PAD + y) * k, (PAD + 20) * k, (PAD + y) * k], fill=(255, 255, 255, 90), width=max(1, k))

    if shape == "car":
        body(4, 8, 18, 36, 7)
        pane(6.5, 15, 13, 7, 2.5)
        pane(7, 23, 12, 10, 2, (255, 255, 255, 56))
        pane(7, 34, 12, 5, 2)
        g.rectangle(box(6.5, 8.6, 3, 1.6), fill="#fde68a")
        g.rectangle(box(16.5, 8.6, 3, 1.6), fill="#fde68a")
    elif shape == "van":
        body(4, 5, 18, 42, 5)
        pane(6, 10, 14, 7, 2)
        pane(6.5, 19, 13, 25, 1.5, (255, 255, 255, 51))
    elif shape == "truck":
        body(5, 2, 16, 12, 4)
        pane(7, 4.5, 12, 4.5, 1.5)
        body(3.5, 16, 19, 34, 2.5)
        ribs([24, 32, 40])
    else:  # trailer
        g.rectangle(box(12, 2, 2, 8), fill=color)
        body(3.5, 9, 19, 41, 2.5)
        ribs([19, 29, 39])

    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(1.6 * k))
    out = Image.alpha_composite(shadow_layer, body_layer)
    return out.resize((size[0] // SS, size[1] // SS), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for shape in ("car", "van", "truck", "trailer"):
        for state, color in COLORS.items():
            for scale, suffix in ((1, ""), (2, "@2x"), (3, "@3x")):
                draw(shape, color, scale).save(OUT / f"veh-{shape}-{state}{suffix}.png", optimize=True)
    print("wrote", len(list(OUT.glob("*.png"))), "files to", OUT)


if __name__ == "__main__":
    main()
