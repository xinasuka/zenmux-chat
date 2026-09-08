#!/usr/bin/env python3
"""
scripts/generate-android-assets.py
Generates high-fidelity Android launcher icons, adaptive icons,
and splash screens from the master icon.png asset.
"""

import os
from PIL import Image, ImageDraw

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_SRC = os.path.join(ROOT_DIR, "icon.png")
RES_DIR = os.path.join(ROOT_DIR, "android", "app", "src", "main", "res")

BG_COLOR = (28, 28, 30, 255)  # #1C1C1E

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def generate_assets():
    print(f"Loading master icon from: {ICON_SRC}")
    master_icon = Image.open(ICON_SRC).convert("RGBA")

    # 1. Generate Adaptive Icon Foreground (Transparent background, safe area ~60%)
    foreground_densities = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }

    print("Generating adaptive icon foregrounds...")
    for folder, size in foreground_densities.items():
        out_dir = os.path.join(RES_DIR, folder)
        ensure_dir(out_dir)

        fg_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        # safe area is 60% of canvas
        logo_size = int(size * 0.60)
        resized_logo = master_icon.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
        offset = ((size - logo_size) // 2, (size - logo_size) // 2)
        fg_img.paste(resized_logo, offset, mask=resized_logo)

        out_path = os.path.join(out_dir, "ic_launcher_foreground.png")
        fg_img.save(out_path, "PNG")
        print(f"  Saved {out_path} ({size}x{size})")

    # 2. Generate Legacy Square & Round Launcher Icons
    launcher_densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }

    print("Generating legacy launcher icons (square & round)...")
    for folder, size in launcher_densities.items():
        out_dir = os.path.join(RES_DIR, folder)
        ensure_dir(out_dir)

        # -- Square with squircle/rounded mask
        square_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw_sq = ImageDraw.Draw(square_img)
        radius = int(size * 0.22)
        draw_sq.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=BG_COLOR)

        logo_sq_size = int(size * 0.72)
        resized_sq = master_icon.resize((logo_sq_size, logo_sq_size), Image.Resampling.LANCZOS)
        offset_sq = ((size - logo_sq_size) // 2, (size - logo_sq_size) // 2)
        square_img.paste(resized_sq, offset_sq, mask=resized_sq)

        sq_path = os.path.join(out_dir, "ic_launcher.png")
        square_img.save(sq_path, "PNG")

        # -- Round with circular mask
        round_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw_rd = ImageDraw.Draw(round_img)
        draw_rd.ellipse([(0, 0), (size - 1, size - 1)], fill=BG_COLOR)

        logo_rd_size = int(size * 0.68)
        resized_rd = master_icon.resize((logo_rd_size, logo_rd_size), Image.Resampling.LANCZOS)
        offset_rd = ((size - logo_rd_size) // 2, (size - logo_rd_size) // 2)
        round_img.paste(resized_rd, offset_rd, mask=resized_rd)

        rd_path = os.path.join(out_dir, "ic_launcher_round.png")
        round_img.save(rd_path, "PNG")
        print(f"  Saved {sq_path} & {rd_path} ({size}x{size})")

    # 3. Generate Android 12+ Splash Icon (288x288, logo centered in 192x192)
    print("Generating Android 12+ splash icon...")
    splash_icon_size = 288
    splash_logo_size = 192
    splash_icon_img = Image.new("RGBA", (splash_icon_size, splash_icon_size), (0, 0, 0, 0))
    resized_splash_logo = master_icon.resize((splash_logo_size, splash_logo_size), Image.Resampling.LANCZOS)
    offset_splash = ((splash_icon_size - splash_logo_size) // 2, (splash_icon_size - splash_logo_size) // 2)
    splash_icon_img.paste(resized_splash_logo, offset_splash, mask=resized_splash_logo)

    drawable_dir = os.path.join(RES_DIR, "drawable")
    ensure_dir(drawable_dir)
    splash_icon_path = os.path.join(drawable_dir, "splash_icon.png")
    splash_icon_img.save(splash_icon_path, "PNG")
    print(f"  Saved {splash_icon_path}")

    # 4. Generate Fullscreen Splash Screens (Portrait & Landscape)
    splash_screens = {
        "drawable": (480, 800),
        "drawable-port-mdpi": (320, 480),
        "drawable-port-hdpi": (480, 800),
        "drawable-port-xhdpi": (720, 1280),
        "drawable-port-xxhdpi": (960, 1600),
        "drawable-port-xxxhdpi": (1280, 1920),
        "drawable-land-mdpi": (480, 320),
        "drawable-land-hdpi": (800, 480),
        "drawable-land-xhdpi": (1280, 720),
        "drawable-land-xxhdpi": (1600, 960),
        "drawable-land-xxxhdpi": (1920, 1280),
    }

    print("Generating full splash screens...")
    for folder, (w, h) in splash_screens.items():
        out_dir = os.path.join(RES_DIR, folder)
        ensure_dir(out_dir)

        splash_canvas = Image.new("RGBA", (w, h), BG_COLOR)
        # Scale logo relative to min dimension (35% of min dimension)
        logo_dim = int(min(w, h) * 0.35)
        logo_dim = max(logo_dim, 64)
        scaled_logo = master_icon.resize((logo_dim, logo_dim), Image.Resampling.LANCZOS)
        offset = ((w - logo_dim) // 2, (h - logo_dim) // 2)
        splash_canvas.paste(scaled_logo, offset, mask=scaled_logo)

        out_path = os.path.join(out_dir, "splash.png")
        splash_canvas.save(out_path, "PNG")
        print(f"  Saved {out_path} ({w}x{h})")

    print("Android assets generation complete!")

if __name__ == "__main__":
    generate_assets()
