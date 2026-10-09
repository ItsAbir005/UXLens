const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const EXTENSION_PATH = path.resolve(__dirname, 'extension');
  const browser = await puppeteer.launch({ headless: 'new', args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`] });
  const page = await browser.newPage();
  
  const targets = await browser.targets();
  const bgTarget = targets.find(t => t.type() === 'service_worker');
  if (bgTarget) {
    const worker = await bgTarget.worker();
    worker.on('console', msg => console.log('BG:', msg.text()));
  }
  
  page.on('console', msg => console.log('PAGE:', msg.text()));

  await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  });
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
