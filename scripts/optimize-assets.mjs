import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const root = process.env.SEVENLEADS_DIR || process.cwd();
const source = path.join(root, 'public', 'background-casino.png');
const output = path.join(root, 'public', 'background-casino.webp');
const executablePath = fs.existsSync(path.join(root, 'chromium', 'chrome.exe')) ? path.join(root, 'chromium', 'chrome.exe') : undefined;
const browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(`file:///${source.replace(/\\/g, '/')}`);
  const dataUrl = await page.evaluate(async () => {
    const image = document.querySelector('img');
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.78);
  });
  fs.writeFileSync(output, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const ratio = Math.round((1 - fs.statSync(output).size / fs.statSync(source).size) * 100);
  console.log(`background-casino.webp criado (${ratio}% menor).`);
} finally {
  await browser.close();
}
