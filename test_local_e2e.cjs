const puppeteer = require('puppeteer');
const path = require('path');
const http = require('http');

const EXTENSION_PATH = path.resolve(__dirname, 'extension');

(async () => {
  console.log("--- Starting Local E2E Test ---");

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <a href="#" id="test-link" style="display:block;width:200px;height:50px;">Click Me</a>
          <button id="test-btn" style="width:200px;height:50px;">Or Click Me</button>
        </body>
      </html>
    `);
  });

  server.listen(4000, () => console.log('   Local server listening on http://localhost:4000'));
  
  const testOrigin = 'http://localhost:4000';
  const userDataDir = path.resolve(__dirname, 'test_profiles', 'profileLocal4');
  const browser = await puppeteer.launch({ 
    headless: false, // NON-HEADLESS FOR EXTENSIONS
    userDataDir, 
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`] 
  });
  
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('   [PAGE]:', msg.text()));
  
  console.log(`   Navigating to ${testOrigin}...`);
  await page.goto(testOrigin, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  
  await page.evaluate(() => console.log("Hello from page evaluate!"));

  console.log('   Performing real page.hover() and page.click()...');
  
  for (let i = 0; i < 2; i++) {
    await page.hover('#test-link');
    await new Promise(r => setTimeout(r, 1100)); // wait for hover throttle
    await page.click('#test-btn');
    await new Promise(r => setTimeout(r, 200));
  }
  
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
  server.close();
  console.log("--- Test Complete ---");
})();