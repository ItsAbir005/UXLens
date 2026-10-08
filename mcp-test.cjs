const http = require('http');

function mcpCall(method, params, id = 1) {
  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:5000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const match = data.match(/data: (.*)/);
          if (match) {
            resolve(JSON.parse(match[1]));
          } else {
            resolve({ raw: data });
          }
        } catch(e) { reject(e); }
      });
    });
    req.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    req.end();
  });
}

async function run() {
  try {
    console.log('--- tools/list ---');
    const tools = await mcpCall('tools/list', {});
    console.log(tools?.result?.tools?.map(t => t.name).join(', '));

    console.log('\n--- get_ux_summary ---');
    const sum = await mcpCall('tools/call', { name: 'get_ux_summary', arguments: { projectId: 'cmutsrerf000064ubeix615h7' } });
    console.log(sum?.result?.content?.[0]?.text);

    console.log('\n--- get_ux_problems ---');
    const probs = await mcpCall('tools/call', { name: 'get_ux_problems', arguments: { projectId: 'cmutsrerf000064ubeix615h7' } });
    const probsJson = JSON.parse(probs?.result?.content?.[0]?.text || '{}');
    console.log('Found ' + (probsJson?.topProblems?.length || 0) + ' problems.');

    const firstProblem = probsJson?.topProblems?.[0];
    
    if (firstProblem) {
      console.log('\n--- get_problem_details ---');
      const det = await mcpCall('tools/call', { name: 'get_problem_details', arguments: { projectId: 'cmutsrerf000064ubeix615h7', problemId: firstProblem.id } });
      console.log(det?.result?.content?.[0]?.text);
    }

    console.log('\n--- get_session_timeline ---');
    const time = await mcpCall('tools/call', { name: 'get_session_timeline', arguments: { projectId: 'cmutsrerf000064ubeix615h7' } });
    console.log(time?.result?.content?.[0]?.text);
  } catch(e) {
    console.error(e);
  }
}
run();
