"""
生成扩展图标。图标是脚本画出来的,不是二进制黑盒:改颜色、调形状后重跑一次即可。

    python scripts/make-icons.py

视觉:蓝到紫的渐变圆角块 + 一个白色右向箭头,表示"把话推到下一站"。
小尺寸用同一个形状但线更粗,避免 16px 下糊成一团。
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"

CANVAS = 256
INSET = 8
RADIUS = 58
TOP_COLOR = (59, 130, 246)
BOTTOM_COLOR = (124, 58, 237)
CHEVRON = [(86, 60), (162, 128), (86, 196)]


def lerp(start, end, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(start, end))


def make_icon(stroke: int) -> Image.Image:
    gradient = Image.new("RGB", (CANVAS, CANVAS))
    painter = ImageDraw.Draw(gradient)
    for y in range(CANVAS):
        painter.line(
            [(0, y), (CANVAS, y)], fill=lerp(TOP_COLOR, BOTTOM_COLOR, y / (CANVAS - 1))
        )

    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [INSET, INSET, CANVAS - INSET, CANVAS - INSET], radius=RADIUS, fill=255
    )

    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    icon.paste(gradient, (0, 0), mask)

    ImageDraw.Draw(icon).line(
        CHEVRON, fill=(255, 255, 255, 255), width=stroke, joint="curve"
    )
    return icon.crop((INSET, INSET, CANVAS - INSET, CANVAS - INSET))


def main():
    OUT.mkdir(exist_ok=True)
    for size in (128, 48):
        make_icon(stroke=30).resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
    for size in (32, 16):
        make_icon(stroke=36).resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()