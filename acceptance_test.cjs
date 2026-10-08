const http = require('http');

function requestJSON(path, method, body, authKey) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (authKey) headers.Authorization = 'Bearer ' + authKey;
    const req = http.request('http://localhost:4000' + path, { method, headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk.toString());
      res.on('end', () => resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runTests() {
  try {
    console.log('1. Enter previously unregistered HTTPS website (Analyze)');
    const a1 = await requestJSON('/api/sites/analyze', 'POST', { origin: 'https://test-a.com' });
    console.log(' - Analyze response:', a1.status, a1.data.id ? 'Got ID' : 'Failed');

    console.log('\n- Simulate Extension visiting the site immediately (within pairing window)');
    const e1 = await requestJSON('/api/sites/resolve', 'POST', { origin: 'https://test-a.com' });
    console.log(' - Extension gets key?', !!e1.data.ingestionKey);
    const authKey1 = e1.data.ingestionKey;

    console.log('\n2. Submit the same URL again (Analyze) and confirm reused');
    const a2 = await requestJSON('/api/sites/analyze', 'POST', { origin: 'https://test-a.com' });
    console.log(' - Same ID reused?', a1.data.id === a2.data.id);

    console.log('\n3. Enter a different website');
    const a3 = await requestJSON('/api/sites/analyze', 'POST', { origin: 'https://test-b.com' });
    console.log(' - New ID?', a3.data.id !== a1.data.id);

    console.log('\n4. Browse first website and verify real events');
    const evt = await requestJSON('/api/events', 'POST', {
      projectId: a1.data.id,
      sessionId: 'sess-a',
      type: 'page_view',
      page: '/home',
      timestamp: Date.now(),
      element: { tagName: 'BODY' },
      metadata: { source: 'test' }
    }, authKey1);
    console.log(' - Event ingested:', evt.status);

    console.log('\n5. Refresh dashboard and confirm events/analytics update');
    const dbEvents = await requestJSON('/api/projects/' + a1.data.id + '/events', 'GET');
    console.log(' - Dashboard events count:', dbEvents.data.events.length);
    const dbProbs = await requestJSON('/api/projects/' + a1.data.id + '/problems', 'GET');
    console.log(' - Dashboard problems format OK?', !!dbProbs.data.problems);

    console.log('\n6. Test previously registered project without credential');
    // We already analyzed test-b.com (a3). We never resolved it yet. Let's assume window expires or is consumed.
    // Let's resolve it now to consume the pairing window.
    await requestJSON('/api/sites/resolve', 'POST', { origin: 'https://test-b.com' });
    // Now window is closed. Another extension comes along:
    const e3_missing = await requestJSON('/api/sites/resolve', 'POST', { origin: 'https://test-b.com' });
    console.log(' - Window closed, extension gets key?', !!e3_missing.data.ingestionKey); // should be false
    
    // Now Dashboard analyzes again to open pairing window:
    await requestJSON('/api/sites/analyze', 'POST', { origin: 'https://test-b.com' });
    const e3_fixed = await requestJSON('/api/sites/resolve', 'POST', { origin: 'https://test-b.com' });
    console.log(' - Window reopened via Dashboard, extension gets key?', !!e3_fixed.data.ingestionKey); // should be true

    console.log('\n7. Test invalid URLs');
    const aBad = await requestJSON('/api/sites/analyze', 'POST', { origin: 'not-a-url' });
    console.log(' - Bad URL status:', aBad.status);

    console.log('\n8. Confirm no fake events');
    console.log(' - Exactly 1 event for test-a?', dbEvents.data.events.length === 1);

  } catch(e) { console.error(e); }
}
runTests();
