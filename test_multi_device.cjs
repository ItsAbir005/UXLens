const puppeteer = require('puppeteer');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const API_BASE = 'https://uxlens-5kcw.onrender.com';
const TEST_SITE = 'https://news.ycombinator.com';
const EXTENSION_PATH = path.resolve(__dirname, 'extension');

function requestJSON(path, method, body, authKey) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (authKey) headers.Authorization = 'Bearer ' + authKey;
    const req = https.request(API_BASE + path, { method, headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk.toString());
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function launchProfile(profileName) {
  const userDataDir = path.resolve(__dirname, 'test_profiles', profileName);
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
  
  const browser = await puppeteer.launch({
    headless: 'new',
    userDataDir,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });
  return browser;
}

async function runMultiDeviceTest() {
  console.log('--- Starting Multi-Device Credential Test ---');

  // 1. Analyze (Creates project or opens pairing window)
  console.log(`1. Opening pairing window for ${TEST_SITE}`);
  const a1 = await requestJSON('/api/sites/analyze', 'POST', { origin: TEST_SITE });
  const projectId = a1.data.id;
  console.log(`   Project ID: ${projectId}`);

  // 2. Pair Browser A
  console.log('\n2. Launching Browser A and pairing...');
  const browserA = await launchProfile('profileA');
  const pageA = await browserA.newPage();
  
  // Track network requests for Browser A
  let authStatusA = null;
  pageA.on('response', res => {
    if (res.url().includes('/api/events') && res.request().method() === 'POST') {
      authStatusA = res.status();
      console.log(`   [Browser A] Event POST status: ${authStatusA}`);
    }
  });

  await pageA.goto(TEST_SITE, { waitUntil: 'networkidle2' });
  await pageA.click('body');
  await new Promise(r => setTimeout(r, 4000)); // wait for flush

  // 3. Open pairing window AGAIN for Browser B
  console.log('\n3. Opening pairing window AGAIN for Browser B');
  await requestJSON('/api/sites/analyze', 'POST', { origin: TEST_SITE });

  // 4. Pair Browser B
  console.log('\n4. Launching Browser B and pairing...');
  const browserB = await launchProfile('profileB');
  const pageB = await browserB.newPage();

  let authStatusB = null;
  pageB.on('response', res => {
    if (res.url().includes('/api/events') && res.request().method() === 'POST') {
      authStatusB = res.status();
      console.log(`   [Browser B] Event POST status: ${authStatusB}`);
    }
  });

  await pageB.goto(TEST_SITE, { waitUntil: 'networkidle2' });
  await pageB.click('body');
  await new Promise(r => setTimeout(r, 4000));

  // 5. Check if Browser A is still active
  console.log('\n5. Clicking again in Browser A to ensure it was NOT invalidated...');
  authStatusA = null;
  await pageA.click('body');
  await new Promise(r => setTimeout(r, 4000));
  
  if (authStatusA === 201 && authStatusB === 201) {
    console.log('   SUCCESS: Both browsers are authenticated simultaneously!');
  } else {
    console.log(`   FAIL: Expected both to be 201. Got A:${authStatusA}, B:${authStatusB}`);
  }

  // 6. Check events on backend
  const dbEvents1 = await requestJSON(`/api/projects/${projectId}/events`, 'GET');
  const countAfterBoth = dbEvents1.data.events?.length || 0;
  console.log(`\n6. Total events fetched from backend: ${countAfterBoth}`);

  // 7. Revoke Browser B's credential via local API
  console.log('\n7. Revoking Browser B credential...');
  await new Promise((resolve, reject) => {
    const http = require('http');
    http.get(`http://localhost:4000/api/test/revoke/${projectId}`, res => {
      res.on('data', () => {});
      res.on('end', resolve);
    }).on('error', reject);
  });
  console.log('   Revocation completed in DB.');

  console.log('\n   Clicking in Browser B (Revoked) - Should NOT increase event count.');
  await pageB.click('body');
  await new Promise(r => setTimeout(r, 4000));
  
  const dbEvents2 = await requestJSON(`/api/projects/${projectId}/events`, 'GET');
  const countAfterRevoked = dbEvents2.data.events?.length || 0;
  
  if (countAfterBoth === countAfterRevoked) {
    console.log(`   SUCCESS: Event count remained at ${countAfterBoth}. Revoked credential rejected.`);
  } else {
    console.log(`   FAIL: Event count increased to ${countAfterRevoked}. Credential still working?`);
  }

  console.log('\n   Clicking in Browser A (Still Valid) - SHOULD increase event count.');
  await pageA.click('body');
  await new Promise(r => setTimeout(r, 4000));

  const dbEvents3 = await requestJSON(`/api/projects/${projectId}/events`, 'GET');
  const countAfterValid = dbEvents3.data.events?.length || 0;

  if (countAfterValid > countAfterRevoked) {
    console.log(`   SUCCESS: Event count increased to ${countAfterValid}. Browser A is still valid!`);
  } else {
    console.log(`   FAIL: Event count remained at ${countAfterRevoked}. Browser A failed.`);
  }

  // 8. Check isolation
  console.log('\n7. Verifying Project Isolation...');
  // Browser A tries to send an event to a fake project
  const fakeProjectId = 'cmfake' + crypto.randomBytes(8).toString('hex');
  const fakeEvent = {
    sessionId: 'test-session',
    type: 'click',
    page: '/',
    timestamp: Date.now(),
    element: { tag: 'body' },
    metadata: { source: 'extension' },
    projectId: fakeProjectId
  };
  
  // Since we don't have Browser A's raw key, we just inject a script into page A to make the request
  console.log(`   Injecting unauthorized cross-project request into Browser A...`);
  
  // We'll create a new dummy project and grab its key, then try to use it for fakeProjectId
  const dummyProj = await requestJSON('/api/sites/resolve', 'POST', { origin: 'https://dummy.com' });
  const dummyKey = dummyProj.data.ingestionKey;

  const isolationTest = await requestJSON('/api/events', 'POST', {
    sessionId: 'test-session',
    type: 'click',
    page: '/',
    timestamp: Date.now(),
    element: { tag: 'body' },
    metadata: { source: 'extension' },
    projectId: fakeProjectId
  }, dummyKey);

  console.log(`   Cross-project request status: ${isolationTest.status}`);
  if (isolationTest.status === 403) {
    console.log('   SUCCESS: Credential properly scoped to its project!');
  } else {
    console.log('   FAIL: Isolation check failed.');
  }

  await browserA.close();
  await browserB.close();
  console.log('\n--- Test Complete ---');
}

runMultiDeviceTest().catch(console.error);
