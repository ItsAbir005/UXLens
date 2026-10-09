const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const API_BASE = 'https://uxlens-5kcw.onrender.com';
const TEST_SITE = 'https://news.ycombinator.com';
const EXTENSION_PATH = path.resolve(__dirname, 'extension');

async function requestJSON(endpoint, method, body) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request(API_BASE + endpoint, { method, headers: { 'Content-Type': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTest() {
  console.log('--- Starting Extension Invalidation Test ---');
  
  const a1 = await requestJSON('/api/sites/analyze', 'POST', { origin: TEST_SITE });
  const projectId = a1.data.id;
  console.log(`1. Target project ID: ${projectId}`);
  
  const userDataDir = path.resolve(__dirname, 'test_profiles', 'profileInvalidation2');
  const browser = await puppeteer.launch({
    headless: 'new',
    userDataDir,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  const page = await browser.newPage();
  page.on('console', msg => {
    console.log(`   [Browser Console] ${msg.type()}:`, msg.text());
  });

  console.log('2. Opening test site...');
  await page.goto(TEST_SITE, { waitUntil: 'networkidle2' });
  await page.click('body');
  await new Promise(r => setTimeout(r, 2000));

  console.log('3. Simulating Extension Reload by calling chrome.runtime.reload() from background script...');
  const targets = await browser.targets();
  const bgTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('extension'));
  if (bgTarget) {
    const worker = await bgTarget.worker();
    await worker.evaluate(() => chrome.runtime.reload());
  }

  await new Promise(r => setTimeout(r, 2000));

  console.log('4. Clicking in stale tab. Should log warning and NOT crash...');
  await page.click('body');
  await new Promise(r => setTimeout(r, 1000));
  await page.click('body'); // Click again to ensure the flag works

  console.log('5. Opening a fresh tab. Tracking should resume...');
  await new Promise(r => setTimeout(r, 3000)); 
  const freshPage = await browser.newPage();
  
  freshPage.on('console', msg => {
    console.log(`   [Fresh Tab Console] ${msg.type()}:`, msg.text());
  });

  const dbEventsBefore = await requestJSON(`/api/projects/${projectId}/events`, 'GET');
  const countBefore = dbEventsBefore.data.events?.length || 0;

  await freshPage.goto(TEST_SITE, { waitUntil: 'networkidle2' });
  await freshPage.click('body');
  await new Promise(r => setTimeout(r, 3000));

  const dbEventsAfter = await requestJSON(`/api/projects/${projectId}/events`, 'GET');
  const countAfter = dbEventsAfter.data.events?.length || 0;

  if (countAfter > countBefore) {
    console.log('   SUCCESS: Events successfully delivered after reload!');
  } else {
    console.log('   FAIL: No successful event POST seen after reload. Counts:', countBefore, '->', countAfter);
  }

  await browser.close();
  console.log('--- Test Complete ---');
}

runTest().catch(console.error);
