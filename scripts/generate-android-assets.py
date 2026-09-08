#!/usr/bin/env python3
"""
scripts/generate-android-assets.py
Generates high-fidelity Android launcher icons, adaptive icons,
and splash screens from the master icon.png asset.
Uses pure white background (#FFFFFF) and centered artwork with ample negative space.
"""

import os
from PIL import Image, ImageDraw

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_SRC = os.path.join(ROOT_DIR, "icon.png")
RES_DIR = os.path.join(ROOT_DIR, "android", "app", "src", "main", "res")

BG_COLOR = (255, 255, 255, 255)  # Pure White #FFFFFF

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def generate_assets():
    print(f"Loading master icon from: {ICON_SRC}")
    master_icon = Image.open(ICON_SRC).convert("RGBA")
    bbox = master_icon.getbbox()
    artwork = master_icon.crop(bbox)
    art_w, art_h = artwork.size
    aspect = art_w / art_h
    print(f"Artwork bounding box: {bbox}, dimensions: {art_w}x{art_h}, aspect: {aspect:.3f}")

    # 1. Generate Adaptive Icon Foreground (Transparent background)
    # Android adaptive icon: Total canvas 108dp, inner mask 72dp.
    # We calibrate the artwork to occupy ~56% of the 72dp visible circle/squircle.
    # 72 / 108 * 0.56 = ~0.3733 of total canvas size.
    foreground_densities = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }

    print("Generating adaptive icon foregrounds (centered with ample whitespace)...")
    for folder, size in foreground_densities.items():
        out_dir = os.path.join(RES_DIR, folder)
        ensure_dir(out_dir)

        fg_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        target_h = int(size * (72.0 / 108.0) * 0.56)
        target_w = int(target_h * aspect)
        resized_logo = artwork.resize((target_w, target_h), Image.Resampling.LANCZOS)
        offset = ((size - target_w) // 2, (size - target_h) // 2)
        fg_img.paste(resized_logo, offset, mask=resized_logo)

        out_path = os.path.join(out_dir, "ic_launcher_foreground.png")
        fg_img.save(out_path, "PNG")
        print(f"  Saved {out_path} ({size}x{size})")

    # 2. Generate Legacy Square & Round Launcher Icons (on pure white background)
    launcher_densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }

    print("Generating legacy launcher icons (square & round on #FFFFFF)...")
    for folder, size in launcher_densities.items():
        out_dir = os.path.join(RES_DIR, folder)
        ensure_dir(out_dir)

        # -- Square with squircle / rounded mask (22% radius)
        square_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw_sq = ImageDraw.Draw(square_img)
        radius = int(size * 0.22)
        draw_sq.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=BG_COLOR)

        target_sq_h = int(size * 0.56)
        target_sq_w = int(target_sq_h * aspect)
        resized_sq = artwork.resize((target_sq_w, target_sq_h), Image.Resampling.LANCZOS)
        offset_sq = ((size - target_sq_w) // 2, (size - target_sq_h) // 2)
        square_img.paste(resized_sq, offset_sq, mask=resized_sq)

        sq_path = os.path.join(out_dir, "ic_launcher.png")
        square_img.save(sq_path, "PNG")

        # -- Round with circular mask
        round_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw_rd = ImageDraw.Draw(round_img)
        draw_rd.ellipse([(0, 0), (size - 1, size - 1)], fill=BG_COLOR)

        target_rd_h = int(size * 0.52)
        target_rd_w = int(target_rd_h * aspect)
        resized_rd = artwork.resize((target_rd_w, target_rd_h), Image.Resampling.LANCZOS)
        offset_rd = ((size - target_rd_w) // 2, (size - target_rd_h) // 2)
        round_img.paste(resized_rd, offset_rd, mask=resized_rd)

        rd_path = os.path.join(out_dir, "ic_launcher_round.png")
        round_img.save(rd_path, "PNG")
        print(f"  Saved {sq_path} & {rd_path} ({size}x{size})")

    # 3. Generate Android 12+ Splash Icon (288x288, logo centered in 160x160 safe zone)
    print("Generating Android 12+ splash icon...")
    splash_icon_size = 288
    splash_logo_h = 160
    splash_logo_w = int(splash_logo_h * aspect)
    splash_icon_img = Image.new("RGBA", (splash_icon_size, splash_icon_size), (0, 0, 0, 0))
    resized_splash_logo = artwork.resize((splash_logo_w, splash_logo_h), Image.Resampling.LANCZOS)
    offset_splash = ((splash_icon_size - splash_logo_w) // 2, (splash_icon_size - splash_logo_h) // 2)
    splash_icon_img.paste(resized_splash_logo, offset_splash, mask=resized_splash_logo)

    drawable_dir = os.path.join(RES_DIR, "drawable")
    ensure_dir(drawable_dir)
    splash_icon_path = os.path.join(drawable_dir, "splash_icon.png")
    splash_icon_img.save(splash_icon_path, "PNG")
    print(f"  Saved {splash_icon_path}")

    # 4. Generate Fullscreen Splash Screens (Portrait & Landscape on pure white #FFFFFF)
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

    print("Generating full splash screens on pure white (#FFFFFF)...")
    for folder, (w, h) in splash_screens.items():
        out_dir = os.path.join(RES_DIR, folder)
        ensure_dir(out_dir)

        splash_canvas = Image.new("RGBA", (w, h), BG_COLOR)
        if h >= w:  # Portrait
            target_w = int(w * 0.22)
            target_h = int(target_w / aspect)
        else:  # Landscape
            target_h = int(h * 0.26)
            target_w = int(target_h * aspect)

        scaled_logo = artwork.resize((target_w, target_h), Image.Resampling.LANCZOS)
        offset = ((w - target_w) // 2, (h - target_h) // 2)
        splash_canvas.paste(scaled_logo, offset, mask=scaled_logo)

        out_path = os.path.join(out_dir, "splash.png")
        splash_canvas.save(out_path, "PNG")
        print(f"  Saved {out_path} ({w}x{h})")

    # 5. Generate PWA / Web App Icons (icon-192.png & icon-512.png on pure white #FFFFFF)
    print("Generating PWA icons (icon-192.png & icon-512.png)...")
    for pwa_size in [192, 512]:
        pwa_canvas = Image.new("RGBA", (pwa_size, pwa_size), BG_COLOR)
        pwa_h = int(pwa_size * 0.56)
        pwa_w = int(pwa_h * aspect)
        scaled_pwa = artwork.resize((pwa_w, pwa_h), Image.Resampling.LANCZOS)
        offset_pwa = ((pwa_size - pwa_w) // 2, (pwa_size - pwa_h) // 2)
        pwa_canvas.paste(scaled_pwa, offset_pwa, mask=scaled_pwa)
        pwa_path = os.path.join(ROOT_DIR, f"icon-{pwa_size}.png")
        pwa_canvas.save(pwa_path, "PNG")
        print(f"  Saved {pwa_path} ({pwa_size}x{pwa_size})")

    print("Android and PWA assets generation complete!")

if __name__ == "__main__":
    generate_assets()
