const http = require('http');

function postJson(path, body, authKey) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (authKey) headers.Authorization = 'Bearer ' + authKey;
    const req = http.request('http://localhost:4000' + path, { method: 'POST', headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk.toString());
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  try {
    console.log('Resolving Amazon...');
    const amz = await postJson('/api/sites/resolve', { origin: 'https://www.amazon.com' });
    console.log('Amazon Resolved:', amz.data);
    
    console.log('\nSending event to Amazon...');
    const amzEvent = await postJson('/api/events', {
      projectId: amz.data.id,
      sessionId: 'sess123',
      type: 'page_view',
      page: '/',
      timestamp: Date.now(),
      element: { tagName: 'BODY' },
      metadata: { source: 'extension' }
    }, amz.data.ingestionKey);
    console.log('Amazon Event Status:', amzEvent.status);

    console.log('\nResolving Amazon again...');
    const amz2 = await postJson('/api/sites/resolve', { origin: 'https://www.amazon.com' });
    console.log('Amazon Re-resolved (same ID?):', amz2.data.id === amz.data.id);

    console.log('\nResolving Example...');
    const ex = await postJson('/api/sites/resolve', { origin: 'https://www.example.com' });
    console.log('Example ID:', ex.data.id);
    console.log('Is different from Amazon?', ex.data.id !== amz.data.id);

    console.log('\nTesting invalid credentials...');
    const failEvent = await postJson('/api/events', {
      projectId: amz.data.id,
      sessionId: 'sess123',
      type: 'page_view',
      page: '/',
      timestamp: Date.now(),
      element: { tagName: 'BODY' },
      metadata: { source: 'extension' }
    }, 'wrong-key');
    console.log('Invalid credential status:', failEvent.status);
    
  } catch(e) {
    console.error(e);
  }
}
run();
