#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to use canvas if available
try {
  const { createCanvas } = await import('canvas');

  // Create 512x512 canvas for high quality
  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, 512, 512);

  // Draw shield outline (blue)
  ctx.strokeStyle = '#2badee';
  ctx.lineWidth = 18;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Shield path
  ctx.beginPath();
  ctx.moveTo(256, 40);
  ctx.lineTo(112, 104);
  ctx.lineTo(112, 216);
  ctx.quadraticCurveTo(256, 408, 256, 408);
  ctx.quadraticCurveTo(256, 408, 400, 216);
  ctx.lineTo(400, 104);
  ctx.closePath();
  ctx.stroke();

  // Draw X (red)
  ctx.strokeStyle = '#ff4757';
  ctx.lineWidth = 20;

  // First diagonal
  ctx.beginPath();
  ctx.moveTo(192, 192);
  ctx.lineTo(320, 320);
  ctx.stroke();

  // Second diagonal
  ctx.beginPath();
  ctx.moveTo(320, 192);
  ctx.lineTo(192, 320);
  ctx.stroke();

  // Save as PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, 'public', 'logo.png'), buffer);

  // Also create 32x32 favicon
  const faviconCanvas = createCanvas(32, 32);
  const faviconCtx = faviconCanvas.getContext('2d');
  faviconCtx.clearRect(0, 0, 32, 32);

  // Scale down the logo
  faviconCtx.drawImage(canvas, 0, 0, 512, 512, 0, 0, 32, 32);

  const faviconBuffer = faviconCanvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, 'public', 'favicon.png'), faviconBuffer);

  console.log('✓ Logo PNG generated successfully!');
  console.log('✓ Favicon PNG generated successfully!');

} catch (err) {
  console.log('Canvas library not available. Using SVG directly.');
  console.log('\nTo generate PNG from SVG, use one of these methods:');
  console.log('\n1. Online converter: https://cloudconvert.com/svg-to-png');
  console.log('   - Upload: public/logo-hires.svg');
  console.log('   - Download as PNG');
  console.log('\n2. Command line (requires ImageMagick):');
  console.log('   convert -background none -density 300 public/logo-hires.svg -resize 512x512 public/logo.png');
  console.log('\n3. Install canvas and run this script:');
  console.log('   npm install canvas');
  console.log('   node generate-logo.js');
}
