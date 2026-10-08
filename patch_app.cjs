const fs = require('fs');
let code = fs.readFileSync('frontend/src/App.jsx', 'utf8');
code = code.replace('</header>', '</header>\\n\\n        <AnalyzeWebsite onAnalyze={(id) => { setRefreshCount(c => c + 1); setSelectedProjectId(id); }} />\\n');
fs.writeFileSync('frontend/src/App.jsx', code);
