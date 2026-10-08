const puppeteer = require('puppeteer');
const path = require('path');
const https = require('https');

function requestJSON(path, method, body, authKey) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (authKey) headers.Authorization = 'Bearer ' + authKey;
    const req = https.request('https://uxlens-5kcw.onrender.com' + path, { method, headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk.toString());
      res.on('end', () => resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testFlow() {
  const extensionPath = path.resolve(__dirname, 'extension');
  console.log('Launching browser with extension at', extensionPath);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const testSite = 'https://news.ycombinator.com';
    console.log(`1. Analyzing website via API: ${testSite}`);
    const a1 = await requestJSON('/api/sites/analyze', 'POST', { origin: testSite });
    console.log(' - Analyze response:', a1.status, a1.data.id ? 'Got ID' : 'Failed');

    console.log(`2. Opening ${testSite} in Chrome to trigger extension pairing...`);
    const targetTab = await browser.newPage();
    await targetTab.goto(testSite, { waitUntil: 'networkidle2' });
    
    console.log('3. Generating interactions on target site...');
    await targetTab.click('body');
    await new Promise(r => setTimeout(r, 4000));
    
    console.log('4. Checking backend for collected events...');
    const dbEvents = await requestJSON('/api/projects/' + a1.data.id + '/events', 'GET');
    console.log(` - Events fetched from backend: ${dbEvents.data.events?.length || 0}`);
    
    if (dbEvents.data.events?.length > 0) {
      console.log(' - Event sample:', dbEvents.data.events[0].type, dbEvents.data.events[0].page);
      console.log('SUCCESS: Real event flowed from Chrome extension -> backend!');
    } else {
      console.log('FAILED: No events found on backend.');
    }
  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    await browser.close();
  }
}

testFlow();
