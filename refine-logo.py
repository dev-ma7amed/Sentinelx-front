#!/usr/bin/env python3
"""Refine SENTINELX logo for enterprise SOC platform"""

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import os

def refine_logo():
    """Load, refine, and export logo in multiple formats"""

    # Load original logo
    img = Image.open('public/logo-original.png')

    # Convert to RGBA if needed
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Resize to standard size (512x512)
    img = img.resize((512, 512), Image.Resampling.LANCZOS)

    # Enhance clarity and reduce noise
    enhancer = ImageEnhance.Sharpness(img)
    img = enhancer.enhance(1.2)  # Slight sharpening

    # Reduce excessive glow by adjusting contrast
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(1.1)  # Slight contrast boost

    # Save main logo (transparent background)
    img.save('public/logo.png')
    print('[OK] Main logo saved: public/logo.png')

    # Create dark-background version
    dark_bg = Image.new('RGBA', (512, 512), (10, 22, 40, 255))
    dark_bg.paste(img, (0, 0), img)
    dark_bg.save('public/logo-dark-bg.png')
    print('[OK] Dark background version saved: public/logo-dark-bg.png')

    # Create icon-only version (compact for navbar/sidebar/favicon)
    icon = img.resize((128, 128), Image.Resampling.LANCZOS)
    icon.save('public/logo-icon.png')
    print('[OK] Icon version saved: public/logo-icon.png')

    # Create favicon (32x32)
    favicon = img.resize((32, 32), Image.Resampling.LANCZOS)
    favicon.save('public/favicon.png')
    print('[OK] Favicon saved: public/favicon.png')

    # Create 64x64 version for sidebar
    sidebar_logo = img.resize((64, 64), Image.Resampling.LANCZOS)
    sidebar_logo.save('public/logo-sidebar.png')
    print('[OK] Sidebar logo saved: public/logo-sidebar.png')

    print('\n[SUCCESS] Logo refinement complete!')
    print('Generated files:')
    print('  - public/logo.png (512x512, transparent)')
    print('  - public/logo-dark-bg.png (512x512, dark background)')
    print('  - public/logo-icon.png (128x128, compact)')
    print('  - public/logo-sidebar.png (64x64, sidebar)')
    print('  - public/favicon.png (32x32, favicon)')

if __name__ == '__main__':
    refine_logo()
