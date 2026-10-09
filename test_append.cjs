  // Test 4: Real event dispatch and queue persistence
  console.log('\n4. Testing real event tracking and queue persistence...');
  const userDataDir4 = path.resolve(__dirname, 'test_profiles', 'profileEvents7');
  const browser4 = await puppeteer.launch({ headless: 'new', userDataDir: userDataDir4, args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`] });
  const page4 = await browser4.newPage();

  const targets4 = await browser4.targets();
  const bgTarget = targets4.find(t => t.type() === 'service_worker');
  if (bgTarget) {
    const worker = await bgTarget.worker();
    worker.on('console', msg => console.log('   [BG]:', msg.text()));
  }

  console.log('   Pairing test.html...');
  const testOrigin = 'https://news.ycombinator.com';
  const resolveRes = await requestJSON('/api/sites/resolve', 'POST', { origin: testOrigin });
  const projectId4 = resolveRes.data.id;

  const eventsRes1 = await requestJSON('/api/projects/' + projectId4 + '/events', 'GET');
  const initialEvents = eventsRes1.data.events || [];
  const initialClicks = initialEvents.filter(e => e.type === 'click').length;
  const initialHovers = initialEvents.filter(e => e.type === 'hover').length;

  console.log('   Navigating to ' + testOrigin + ' and generating events...');
  await page4.goto(testOrigin, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('   Generating clicks and hovers on interactive elements...');
  await page4.evaluate(async () => {
    const btn = document.createElement('button');
    btn.textContent = 'test';
    document.body.appendChild(btn);
    for (let i = 0; i < 5; i++) {
      btn.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, composed: true }));
      await new Promise(r => setTimeout(r, 1100)); // wait for throttle
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise(r => setTimeout(r, 100));
      document.body.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, composed: true }));
      await new Promise(r => setTimeout(r, 10));
    }
  });

  console.log('   Waiting 5 seconds for background processing...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('   Simulating Service Worker restart (to test queue persistence)...');
  // Just kill the worker and revive
  if (bgTarget) {
    const worker = await bgTarget.worker();
    try { await worker.evaluate(() => { close(); }); } catch {}
  }
  await new Promise(r => setTimeout(r, 3000));

  console.log('   Awakening Service Worker with a new event...');
  await page4.evaluate(() => { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); });
  await new Promise(r => setTimeout(r, 5000)); // wait for flush

  const eventsRes2 = await requestJSON('/api/projects/' + projectId4 + '/events', 'GET');
  const finalEvents = eventsRes2.data.events || [];
  const finalClicks = finalEvents.filter(e => e.type === 'click').length;
  const finalHovers = finalEvents.filter(e => e.type === 'hover').length;

  const addedClicks = finalClicks - initialClicks;
  const addedHovers = finalHovers - initialHovers;
  if (addedClicks >= 5 && addedHovers >= 2) {
    console.log(`   SUCCESS: Click and hover events successfully tracked and delivered (added ${addedClicks} clicks, ${addedHovers} hovers).`);
  } else {
    console.log(`   FAIL: Expected at least 5 clicks and 2 hovers, got ${addedClicks} clicks and ${addedHovers} hovers.`);
  }

  await browser4.close();

  console.log('\n--- Test Complete ---');
}
runTest().catch(console.error);