#!/usr/bin/env python3
"""Shrink simulation renders, figures and photos for the website.

Examples
    python tools/prepare_images.py ~/renders images/gallery
    python tools/prepare_images.py fig1.png images/research --format png

Each image is resized so its longest side is at most --max pixels (default
2000) and saved without metadata, as JPEG (renders and photos, small files)
or PNG (plots with text and thin lines, stays sharp). File names are kept and
the extension changes to match the format. Originals are never overwritten.

Needs Pillow:  pip install pillow
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp"}


def prepare(src, out_dir, max_side, fmt, quality, background):
    ext = ".jpg" if fmt == "jpg" else ".png"
    dst = out_dir / (src.stem + ext)
    if dst.resolve() == src.resolve():
        print(f"skip  {src.name}: output would overwrite the original")
        return None
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode.startswith("I;16") or im.mode == "I":
            # 16-bit or integer images: scale to 8 bits instead of clipping
            im = im.convert("I").point(lambda v: v * (1 / 256)).convert("L")
        elif im.mode not in ("RGB", "RGBA", "L", "LA", "P"):
            im = im.convert("RGBA")
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        if fmt == "jpg":
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                fill = (0, 0, 0) if background == "black" else (255, 255, 255)
                flat = Image.new("RGB", im.size, fill)
                flat.paste(im, mask=im.getchannel("A"))
                im = flat
            else:
                im = im.convert("RGB")
            im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
        else:
            im.save(dst, "PNG", optimize=True)
        size = im.size
    before = src.stat().st_size / 1e6
    after = dst.stat().st_size / 1e6
    print(f"done  {src.name} -> {dst}  {size[0]}x{size[1]}  {before:.1f} MB -> {after:.2f} MB")
    return dst


def main():
    parser = argparse.ArgumentParser(description="Resize images for the website.")
    parser.add_argument("source", type=Path, help="an image file or a folder of images")
    parser.add_argument("out_dir", type=Path, help="where to write the web versions, e.g. images/gallery")
    parser.add_argument("--max", type=int, default=2000, help="longest side in pixels (default 2000)")
    parser.add_argument("--format", choices=["jpg", "png"], default="jpg",
                        help="jpg for renders and photos (default), png for plots")
    parser.add_argument("--quality", type=int, default=86, help="JPEG quality, 1-95 (default 86)")
    parser.add_argument("--background", choices=["black", "white"], default="black",
                        help="fill for transparent areas when saving JPEG (default black)")
    args = parser.parse_args()

    if args.source.is_dir():
        files = sorted(p for p in args.source.iterdir() if p.suffix.lower() in IMAGE_TYPES)
    elif args.source.is_file():
        files = [args.source]
    else:
        sys.exit(f"Not found: {args.source}")
    if not files:
        sys.exit(f"No images in {args.source}")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for src in files:
        try:
            prepare(src, args.out_dir, args.max, args.format, args.quality, args.background)
        except Exception as err:  # keep going if one file is unreadable
            print(f"error {src.name}: {err}")


if __name__ == "__main__":
    main()
