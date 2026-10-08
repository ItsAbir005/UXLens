const puppeteer = require('puppeteer');
const path = require('path');
const http = require('http');

async function testFlow() {
  const extensionPath = path.resolve(__dirname, 'extension');
  console.log('Launching browser with extension at', extensionPath);

  // Use new headless mode which supports extensions
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const page = await browser.newPage();
    
    // 1. Open Dashboard
    console.log('1. Opening dashboard...');
    await page.goto('http://127.0.0.1:5173');
    
    // Wait for Analyze button
    await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    
    // 2. Enter website URL and Analyze
    const testSite = 'https://news.ycombinator.com'; // Simple public website
    console.log(`2. Analyzing website: ${testSite}`);
    await page.type('input[type="url"]', testSite);
    
    const [analyzeResponse] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/sites/analyze') && response.request().method() === 'POST'),
      page.click('button[type="submit"]')
    ]);
    
    console.log(' - Analyze API returned status:', analyzeResponse.status());
    await page.waitForFunction(() => document.body.innerText.includes('Registered https://news.ycombinator.com'));
    console.log(' - Pairing window opened successfully.');

    // 3. Open the target website in a new tab (within 60s)
    console.log(`3. Opening ${testSite} to trigger extension pairing...`);
    const targetTab = await browser.newPage();
    await targetTab.goto(testSite, { waitUntil: 'networkidle2' });
    
    // Interact with it to generate events
    console.log('4. Generating interactions on target site...');
    await targetTab.waitForSelector('a', { timeout: 10000 });
    await targetTab.click('a'); // click a link
    await new Promise(r => setTimeout(r, 2000)); // wait for extension to send event

    // Check extension background logs? Puppeteer can't easily intercept extension network requests unless we use the service worker.
    // Instead we check the dashboard.
    
    // 5. Check dashboard
    console.log('5. Checking dashboard for collected events...');
    await page.bringToFront();
    
    // Ensure the project is selected
    const selectedProjectValue = await page.$eval('select', el => el.options[el.selectedIndex].text);
    console.log(' - Currently selected project in dropdown:', selectedProjectValue);
    
    // Click Refresh
    const [eventsResponse] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/projects/') && response.url().includes('/events')),
      page.click('.refresh-btn')
    ]);
    
    const eventsData = await eventsResponse.json();
    console.log(` - Events fetched from backend: ${eventsData.events.length}`);
    if (eventsData.events.length > 0) {
      console.log(' - Event sample:', eventsData.events[0].type, eventsData.events[0].page);
      console.log('SUCCESS: Real event flowed from extension -> backend -> dashboard!');
    } else {
      console.log('FAILED: No events found on dashboard.');
    }
    
    // 6. Test a second website
    const testSite2 = 'https://example.com';
    console.log(`\n6. Analyzing second website: ${testSite2}`);
    await page.click('input[type="url"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('input[type="url"]', testSite2);
    
    const [analyzeResponse2] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/sites/analyze') && response.request().method() === 'POST'),
      page.click('button[type="submit"]')
    ]);
    console.log(' - Second analyze API returned status:', analyzeResponse2.status());
    
    console.log(`7. Opening ${testSite2}...`);
    const targetTab2 = await browser.newPage();
    await targetTab2.goto(testSite2, { waitUntil: 'networkidle2' });
    await targetTab2.click('body');
    await new Promise(r => setTimeout(r, 2000));
    
    console.log('8. Checking dashboard for second site events...');
    await page.bringToFront();
    const [eventsResponse2] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/projects/') && response.url().includes('/events')),
      page.click('.refresh-btn')
    ]);
    
    const eventsData2 = await eventsResponse2.json();
    console.log(` - Events fetched from backend for site 2: ${eventsData2.events.length}`);
    
    if (eventsData2.events.length > 0) {
      console.log('SUCCESS: Second site tested successfully!');
    } else {
      console.log('FAILED: No events found for second site.');
    }
    
    console.log('\nAll tests completed.');

  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    await browser.close();
  }
}

testFlow();
