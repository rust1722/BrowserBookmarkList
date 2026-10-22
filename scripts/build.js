#!/usr/bin/env node
/* Build: inline styles.css + app.js into a single self-contained HTML file. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const read = (p) => fs.readFileSync(p, 'utf8');

const template = read(path.join(src, 'template.html'));
const styles = read(path.join(src, 'styles.css'));
const script = read(path.join(src, 'app.js'));

const version = JSON.parse(read(path.join(root, 'package.json'))).version;
const banner = `/*! Bookmark Station v${version} — single-file bookmark manager. ${new Date().toISOString().slice(0, 10)} */`;

if (!/__STYLES__/.test(template) || !/__SCRIPT__/.test(template)) {
  console.error('template.html is missing __STYLES__ or __SCRIPT__ markers');
  process.exit(1);
}

// guard against accidentally closing the inline <script> tag
const safeScript = script.replace(/<\/script/gi, '<\\/script');

const html = template
  .replace('__STYLES__', () => styles)
  .replace('__SCRIPT__', () => banner + '\n' + safeScript);

fs.writeFileSync(path.join(root, 'bookmark-station.html'), html);
fs.writeFileSync(path.join(root, 'index.html'), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`✓ bookmark-station.html + index.html — ${kb} KB (styles ${(styles.length / 1024).toFixed(1)} KB, script ${(script.length / 1024).toFixed(1)} KB)`);
