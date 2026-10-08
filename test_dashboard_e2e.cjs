const puppeteer = require('puppeteer');
const path = require('path');

async function testDashboardFlow() {
  const extensionPath = path.resolve(__dirname, 'extension');
  console.log('Launching browser with extension at', extensionPath);

  const browser = await puppeteer.launch({
    headless: 'new', // new headless mode supports extensions
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const page = await browser.newPage();
    
    // 1. Open the deployed UXLens dashboard (served locally)
    console.log('1. Opening dashboard UI...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    
    // Wait for Analyze button
    await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    
    // 2. Enter website URL and Analyze
    const testSite = 'https://news.ycombinator.com';
    console.log(`2. Entering website URL: ${testSite}`);
    await page.type('input[type="url"]', testSite);
    
    const [analyzeResponse] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/sites/analyze') && res.request().method() === 'POST'),
      page.click('button[type="submit"]')
    ]);
    
    console.log(' - Analyze button clicked. UI Loading...');
    const analyzeData = await analyzeResponse.json();
    console.log(' - Project registered with ID:', analyzeData.id);
    
    // Wait for the success message to appear in the UI
    await page.waitForFunction(() => document.body.innerText.includes('Action Required: To begin collecting data'));
    console.log(' - Success message displayed on Dashboard UI.');

    // 4. Open the target website in a new tab (within 60s)
    console.log(`4. Opening ${testSite} in the same browser profile...`);
    const targetTab = await browser.newPage();
    await targetTab.goto(testSite, { waitUntil: 'networkidle2' });
    
    // 5. Interact with the page to trigger events
    console.log('5. Clicking around on the target site...');
    await targetTab.click('body');
    await new Promise(r => setTimeout(r, 4000)); // wait for extension to collect and flush events
    
    // Go back to the dashboard tab and click "Refresh Data"
    console.log(' - Going back to Dashboard UI and clicking Refresh Data...');
    await page.bringToFront();
    
    // Click Refresh
    const [eventsResponse] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/events')),
      page.click('.refresh-btn')
    ]);
    
    const eventsData = await eventsResponse.json();
    console.log(` - Dashboard refreshed. Backend returned ${eventsData.events?.length || 0} events.`);
    
    // 6. Register a second website and verify it has a separate project
    const testSite2 = 'https://www.wikipedia.org';
    console.log(`\n6. Entering second website URL: ${testSite2}`);
    
    // clear input
    await page.click('input[type="url"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('input[type="url"]', testSite2);
    
    const [analyzeResponse2] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/sites/analyze') && res.request().method() === 'POST'),
      page.click('button[type="submit"]')
    ]);
    
    const analyzeData2 = await analyzeResponse2.json();
    console.log(' - Second project registered with ID:', analyzeData2.id);
    
    if (analyzeData.id !== analyzeData2.id) {
      console.log(' - SUCCESS: Projects are completely separate.');
    } else {
      console.log(' - FAIL: Projects are not separate.');
    }
    
    console.log(` - Opening ${testSite2} in a new tab...`);
    const targetTab2 = await browser.newPage();
    await targetTab2.goto(testSite2, { waitUntil: 'networkidle2' });
    await targetTab2.click('body');
    await new Promise(r => setTimeout(r, 4000));
    
    console.log(' - Refreshing dashboard again for site 2...');
    await page.bringToFront();
    const [eventsResponse2] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/events')),
      page.click('.refresh-btn')
    ]);
    
    const eventsData2 = await eventsResponse2.json();
    console.log(` - Dashboard refreshed. Backend returned ${eventsData2.events?.length || 0} events for site 2.`);
    
    console.log('\nAll Dashboard UI end-to-end tests completed.');

  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    await browser.close();
  }
}

testDashboardFlow();
