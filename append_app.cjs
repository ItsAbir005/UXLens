const fs = require('fs');

const componentCode = \
function AnalyzeWebsite({ onAnalyze }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
      
      setStatus({ loading: true });
      const res = await fetch(\\\\/api/sites/analyze\\\, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: parsed.origin })
      });
      if (!res.ok) throw new Error('Failed to register website');
      const data = await res.json();
      
      setStatus({ 
        success: true, 
        project: data, 
        message: \\\Registered \.\\n\\nAction Required: To begin collecting data, please open \ in a new tab within the next 60 seconds (with the UXLens extension installed). If the site is already open, simply refresh the page. Once done, click Refresh Data below.\\\ 
      });
      onAnalyze(data.id);
      setUrl('');
    } catch (err) {
      setStatus({ error: 'Please enter a valid HTTP or HTTPS URL.' });
    }
  };

  return (
    <div style={{ padding: '1.5rem', background: '#f8faf9', borderRadius: '8px', border: '1px solid #dfe7df', marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Analyze a Website</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <input type='url' required placeholder='https://www.example.com' value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1, padding: '0.6rem', border: '1px solid #cad8cd', borderRadius: '4px' }} />
        <button type='submit' disabled={status?.loading} style={{ padding: '0.6rem 1.2rem', background: '#17342d', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {status?.loading ? 'Registering...' : 'Analyze'}
        </button>
      </form>
      {status?.error && <div style={{ color: '#d25c3b', marginTop: '0.8rem', fontSize: '0.9rem' }}>{status.error}</div>}
      {status?.success && (
        <div style={{ background: '#e8f4eb', color: '#1b4d32', padding: '1rem', borderRadius: '4px', marginTop: '1rem', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
          <strong>{status.message}</strong>
        </div>
      )}
    </div>
  );
}
\;

let code = fs.readFileSync('frontend/src/App.jsx', 'utf8');
code = code.replace('</header>', '</header>\\n\\n        <AnalyzeWebsite onAnalyze={(id) => { setRefreshCount(c => c + 1); setSelectedProjectId(id); }} />\\n');
code += '\\n\\n' + componentCode;

fs.writeFileSync('frontend/src/App.jsx', code);

