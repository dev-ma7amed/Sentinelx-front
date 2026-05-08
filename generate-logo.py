#!/usr/bin/env python3
"""Generate PNG logo from SVG using PIL"""

import os
import sys

try:
    from PIL import Image, ImageDraw

    # Create 512x512 image with transparent background
    img = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Shield outline (blue: #2badee)
    blue = (43, 173, 238, 255)
    red = (255, 71, 87, 255)

    # Draw shield outline
    # Shield path: top point, left side, bottom left, bottom center, bottom right, right side
    shield_points = [
        (256, 40),      # top
        (112, 104),     # top left
        (112, 216),     # left side
        (256, 408),     # bottom center
        (400, 216),     # right side
        (400, 104),     # top right
    ]

    draw.polygon(shield_points, outline=blue, width=18)

    # Draw X (red)
    # First diagonal
    draw.line([(192, 192), (320, 320)], fill=red, width=20)
    # Second diagonal
    draw.line([(320, 192), (192, 320)], fill=red, width=20)

    # Save as PNG
    img.save('public/logo.png')

    # Create 32x32 favicon
    favicon = img.resize((32, 32), Image.Resampling.LANCZOS)
    favicon.save('public/favicon.png')

    print('[OK] Logo PNG generated successfully!')
    print('[OK] Favicon PNG generated successfully!')

except ImportError:
    print('PIL not available. Please install it:')
    print('  pip install Pillow')
    print('')
    print('Or use an online converter:')
    print('  https://cloudconvert.com/svg-to-png')
    sys.exit(1)

