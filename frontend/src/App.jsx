import { useEffect, useState, Fragment } from "react";

const backendUrl = import.meta.env.VITE_API_BASE_URL || "https://uxlens-5kcw.onrender.com";

const problemCards = [
  { type: "repeated_click", label: "Repeated clicks", tone: "red" },
  { type: "dead_click", label: "Dead clicks", tone: "orange" },
  { type: "hesitation", label: "Hesitation", tone: "yellow" },
  { type: "backtracking", label: "Backtracking", tone: "blue" }
];

const getAuthHeaders = () => {
  const key = localStorage.getItem("uxlens_ingestion_key");
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const readJson = async (url) => {
  const response = await fetch(url, { headers: getAuthHeaders() });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Authentication required. Please set your ingestion key.");
    throw new Error("The dashboard could not load this data.");
  }
  return response.json();
};

const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString([], {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
});

export default function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, _setSelectedProjectId] = useState(() => {
    try { return localStorage.getItem("uxlens_selected_project") || ""; } catch { return ""; }
  });

  const setSelectedProjectId = (idOrUpdater) => {
    _setSelectedProjectId(prev => {
      const newId = typeof idOrUpdater === "function" ? idOrUpdater(prev) : idOrUpdater;
      try { localStorage.setItem("uxlens_selected_project", newId); } catch {}
      return newId;
    });
  };
  const [dashboard, setDashboard] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    readJson(`${backendUrl}/api/projects`)
      .then((data) => { 
        setProjects(data); 
        setSelectedProjectId(current => {
          if (current && data.find(p => p.id === current)) return current;
          return data[0]?.id || "";
        });
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoadingProjects(false));
  }, [refreshCount]);

  useEffect(() => {
    const interval = setInterval(() => setRefreshCount(c => c + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setRefreshCount(c => c + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) { setDashboard(null); setEvents([]); return; }
    setLoadingDashboard(true);
    setError("");
    Promise.all([
      readJson(`${backendUrl}/api/projects/${selectedProjectId}/problems`),
      readJson(`${backendUrl}/api/projects/${selectedProjectId}/events`)
    ])
      .then(([problemData, eventData]) => { setDashboard(problemData); setEvents(eventData.events); })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoadingDashboard(false));
  }, [selectedProjectId, refreshCount]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  return (
    <div className="app-shell">
      <style>{`
        .severity.low { color: #2d6a4f; background: #d8f3dc; }
        .refresh-btn { background: #e6c96e; color: #17342d; border: none; padding: 0.5rem 1rem; border-radius: 4px; font-weight: 600; cursor: pointer; font-family: inherit; font-size: 0.85rem; transition: opacity 0.2s; }
        .refresh-btn:hover { opacity: 0.9; }
        .health-score-card { display: flex; align-items: center; gap: 1.5rem; background: #fff; padding: 1.5rem; border-radius: 8px; border: 1px solid #dfe7df; margin-bottom: 2rem; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
        .health-circle { flex-shrink: 0; width: 85px; height: 85px; border-radius: 50%; color: #fff; display: grid; place-items: center; font-size: 2.2rem; font-weight: 800; border: 4px solid rgba(255,255,255,0.3); }
        .friction-chart { display: flex; height: 16px; border-radius: 8px; overflow: hidden; margin-top: 1.5rem; background: #edf3ed; }
        .chart-segment { height: 100%; transition: width 0.3s ease; }
        .chart-segment.red { background: #d25c3b; } .chart-segment.orange { background: #d98c46; } .chart-segment.yellow { background: #c8a83c; } .chart-segment.blue { background: #5a8bb2; }
        .journey-card { padding: 1rem; background: #fff; border-radius: 6px; border: 1px solid #dfe7df; margin-bottom: 1rem; }
        .journey-nodes { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
        .journey-node { padding: 0.5rem 0.75rem; border-radius: 4px; font-size: 0.8rem; border: 1px solid; }
        .journey-node.friction { background: #fff0eb; border-color: #efc6bb; color: #a3402d; }
        .journey-node.safe { background: #edf3ed; border-color: #cad8cd; color: #304d42; }
        .top-areas-list { display: grid; gap: 0.75rem; margin-top: 1.5rem; }
        .top-area-card { display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1rem; background: #fff; border: 1px solid #dfe7df; border-radius: 6px; }
      `}</style>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">U</span><span>UXLens</span></div>
        <div className="sidebar-label" style={{ marginTop: "1rem" }}>Workspace</div>
        <label className="project-picker">
          <span>Project</span>
          <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={loadingProjects || projects.length === 0}>
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <nav className="side-nav" aria-label="Primary navigation">
          <a className="active" href="#overview"><span className="nav-icon">◈</span>Overview</a>
          <a href="#problems"><span className="nav-icon">△</span>UX problems</a>
          <a href="#timeline"><span className="nav-icon">≡</span>Session journeys</a>
        </nav>
        <div className="sidebar-footer"><span className="status-dot" />Tracking connected</div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div><p className="kicker">Product experience / Overview</p><h1>Understand where users pause.</h1></div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div className="topbar-project">{selectedProject?.website || "Select a project"}</div>
            <button className="refresh-btn" onClick={() => setRefreshCount(c => c + 1)}>Refresh Data</button>
          </div>
        </header>

        <AnalyzeWebsite onAnalyze={(id) => { setRefreshCount(c => c + 1); setSelectedProjectId(id); }} />


        {error && <div className="alert" role="alert">{error}</div>}
        {loadingProjects || loadingDashboard ? <div className="state-panel"><span className="loader" />Loading your experience data...</div> : null}
        {!loadingProjects && !loadingDashboard && !error && projects.length === 0 && <div className="state-panel empty-state"><strong>No project data yet</strong><span>Add a project and install the tracker to see UX signals here.</span></div>}

        {!loadingProjects && !loadingDashboard && dashboard && <>
          <section id="overview" className="summary-section">
            <HealthOverview dashboard={dashboard} events={events} />
            
            <div className="section-heading"><div><p className="kicker">Signal overview</p><h2>UX friction breakdown</h2></div><span className="updated-label">{dashboard.problems.length} detected signals</span></div>
            <div className="problem-summary-grid">
              {problemCards.map((card) => <div className={`summary-card ${card.tone}`} key={card.type}><span className="signal-dot" /><span className="summary-label">{card.label}</span><strong>{dashboard.summary[card.type] || 0}</strong><span className="summary-caption">occurrences</span></div>)}
            </div>
            <FrictionChart summary={dashboard.summary} />
          </section>

          <div className="content-grid">
            <section id="problems" className="panel problems-panel">
              <div className="panel-heading"><div><p className="kicker">Evidence-led review</p><h2>Top problematic elements</h2></div><span className="count-badge">{dashboard.problems.length}</span></div>
              {dashboard.problems.length === 0 ? <div className="panel-empty">No UX friction detected yet.<br/>Browse the website with the UXLens extension to collect real interaction data.</div> : <div className="problem-list">{dashboard.problems.map((problem) => <ProblemCard key={problem.id} problem={problem} />)}</div>}
              
              <div className="panel-heading" style={{ marginTop: "3rem" }}><div><p className="kicker">Hotspots</p><h2>Top friction areas</h2></div></div>
              <TopAreas problems={dashboard.problems} />
            </section>

            <section id="timeline" className="panel timeline-panel">
              <div className="panel-heading"><div><p className="kicker">Latest activity</p><h2>User journeys</h2></div><span className="count-badge">{new Set(events.map(e => e.sessionId)).size}</span></div>
              {events.length === 0 ? <div className="panel-empty">No UX friction detected yet.<br/>Browse the website with the UXLens extension to collect real interaction data.</div> : <UserJourneys events={events} />}
            </section>
          </div>
        </>}
      </main>
    </div>
  );
}

function HealthOverview({ dashboard }) {
  const totalOccurrences = Object.values(dashboard.summary || {}).reduce((a, b) => a + b, 0);
  const totalSessions = dashboard.totalSessions || 0;
  const totalEvents = dashboard.totalEvents || 0;
  
  // Health score formula:
  // Base 100. Deduct 10 points per average friction occurrence per session. Floor at 0.
  const score = totalSessions > 0 
    ? Math.max(0, Math.round(100 - (totalOccurrences / totalSessions) * 10))
    : 100;
    
  let color = "#79c58d";
  if (score < 90) color = "#c8a83c";
  if (score < 70) color = "#d25c3b";

  let dominantType = "None";
  let maxCount = 0;
  Object.entries(dashboard.summary || {}).forEach(([type, count]) => {
    if (count > maxCount) { maxCount = count; dominantType = type.replace("_", " "); }
  });

  return (
    <div className="health-score-card">
      <div className="health-circle" style={{ background: color }}>{score}</div>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.35rem", color: "#17342d" }}>UX Health Score</h2>
        <p style={{ margin: "0.2rem 0 0", color: "#607870", fontSize: "0.85rem", maxWidth: "320px", lineHeight: 1.4 }}>
          Calculated from <strong>{totalOccurrences}</strong> friction occurrences across <strong>{totalSessions}</strong> recorded sessions.
        </p>
      </div>
      <div style={{ marginLeft: "auto", display: "grid", gap: "0.4rem", textAlign: "right", fontSize: "0.85rem", color: "#607870" }}>
         <div><strong style={{ color: "#17342d" }}>{totalEvents}</strong> tracked events</div>
         <div><strong style={{ color: "#17342d" }}>{dashboard.problems.length}</strong> problem areas</div>
         <div>Dominant friction: <strong style={{ color: "#17342d", textTransform: "capitalize" }}>{dominantType}</strong></div>
      </div>
    </div>
  );
}

function FrictionChart({ summary }) {
  const totalOccurrences = Object.values(summary || {}).reduce((a, b) => a + b, 0);
  if (totalOccurrences === 0) return null;
  return (
    <div className="friction-chart">
      {problemCards.map(card => {
        const count = summary[card.type] || 0;
        const width = (count / totalOccurrences) * 100;
        if (width === 0) return null;
        return <div key={card.type} className={`chart-segment ${card.tone}`} style={{ width: `${width}%` }} title={`${card.label}: ${count}`} />
      })}
    </div>
  );
}

function TopAreas({ problems }) {
  if (problems.length === 0) return null;
  
  const pageFriction = {};
  problems.forEach(p => {
    if (!pageFriction[p.page]) pageFriction[p.page] = { count: 0, types: {} };
    pageFriction[p.page].count += p.occurrences;
    pageFriction[p.page].types[p.type] = (pageFriction[p.page].types[p.type] || 0) + p.occurrences;
  });
  
  const topPages = Object.entries(pageFriction).map(([page, data]) => {
    const dominant = Object.keys(data.types).reduce((a, b) => data.types[a] > data.types[b] ? a : b);
    return { page, count: data.count, dominant };
  }).sort((a, b) => b.count - a.count).slice(0, 5);

  return (
    <div className="top-areas-list">
      {topPages.map(area => (
        <div key={area.page} className="top-area-card">
          <strong style={{ fontSize: "0.9rem", color: "#17342d", wordBreak: "break-all" }}>{area.page}</strong>
          <div style={{ display: "flex", alignItems: "center", gap: "1.2rem", fontSize: "0.8rem", color: "#607870" }}>
             <span style={{ textTransform: "capitalize" }}>{area.dominant.replace("_", " ")}</span>
             <strong style={{ color: "#d25c3b", padding: "0.2rem 0.5rem", background: "#fff0eb", borderRadius: "4px" }}>{area.count} signals</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function UserJourneys({ events }) {
  const sessions = {};
  events.forEach(e => {
    if (!sessions[e.sessionId]) sessions[e.sessionId] = [];
    sessions[e.sessionId].push(e);
  });

  const sessionList = Object.entries(sessions).map(([id, evts]) => {
     const sorted = evts.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
     const journeyNodes = [];
     let currentNode = null;
     
     sorted.forEach(e => {
       if (!currentNode || currentNode.page !== e.page) {
         if (currentNode) journeyNodes.push(currentNode);
         currentNode = { page: e.page, friction: new Set() };
       }
       if (e.type === "repeated_click") currentNode.friction.add("Repeated Click");
       
       if (e.type === "click") {
          const hoverDuration = e.metadata?.hoverToClickDuration;
          if (hoverDuration && hoverDuration > 3000) currentNode.friction.add("Hesitation");
          
          const hasNav = sorted.some(cand => cand.type === 'navigation' && new Date(cand.timestamp).getTime() > new Date(e.timestamp).getTime() && (new Date(cand.timestamp).getTime() - new Date(e.timestamp).getTime()) <= 5000);
          if (!hasNav && currentNode.friction.size === 0) {
            // Inference only applied if no explicit navigation found, acting as a visual helper.
            currentNode.friction.add("Dead Click");
          }
       }
       // Note: Backtracking is implied by visual cycles in the journey nodes.
     });
     if (currentNode) journeyNodes.push(currentNode);

     return { id, nodes: journeyNodes };
  });

  // Display most recent sessions based on array order from backend
  const displaySessions = sessionList.slice(0, 15);

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {displaySessions.map(session => (
        <div key={session.id} className="journey-card">
          <div style={{ fontSize: "0.65rem", color: "#8a9c93", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "monospace" }}>Session {session.id.split("-")[0]}</div>
          <div className="journey-nodes">
             {session.nodes.map((node, i) => (
               <Fragment key={i}>
                 {i > 0 && <span style={{ color: "#cad8cd", fontSize: "0.9rem" }}>→</span>}
                 <div className={`journey-node ${node.friction.size > 0 ? "friction" : "safe"}`}>
                   <strong>{node.page}</strong>
                   {node.friction.size > 0 && (
                     <div style={{ fontSize: "0.65rem", marginTop: "0.3rem", fontWeight: "700", textTransform: "uppercase" }}>
                       {Array.from(node.friction).join(", ")}
                     </div>
                   )}
                 </div>
               </Fragment>
             ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProblemCard({ problem }) {
  // Deterministic Severity Classification
  const classifySeverity = (p) => {
    if ((p.type === "repeated_click" || p.type === "dead_click") && p.occurrences > 3) return "high";
    if (p.type === "backtracking" || p.occurrences > 1) return "medium";
    return "low";
  };
  
  const severity = classifySeverity(problem);
  
  return (
    <article className="problem-card">
      <div className="problem-card-top">
        <span className={`severity ${severity}`}>{severity}</span>
        <span className="occurrences">{problem.occurrences} occurrences</span>
      </div>
      <h3 style={{ textTransform: "capitalize" }}>{problem.type.replace("_", " ")}</h3>
      <div className="problem-target">
        <strong>{problem.element}</strong>
        <span>{problem.page}</span>
      </div>
      <div className="evidence">
        <span>Evidence</span>
        <ul>
          {problem.evidence.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </article>
  );
}

function AnalyzeWebsite({ onAnalyze }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      setStatus({ loading: true });
      const res = await fetch(backendUrl + "/api/sites/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: parsed.origin })
      });
      if (!res.ok) throw new Error("Failed to register website");
      const data = await res.json();
      setStatus({ 
        success: true, 
        project: data, 
        message: "Registered " + parsed.origin + ".\n\nAction Required: To begin collecting data, please open " + parsed.origin + " in a new tab within the next 60 seconds (with the UXLens extension installed). If the site is already open, simply refresh the page. Once done, click Refresh Data below." 
      });
      onAnalyze(data.id);
      setUrl("");
    } catch (err) {
      setStatus({ error: "Please enter a valid HTTP or HTTPS URL." });
    }
  };

  return (
    <div style={{ padding: "1.5rem", background: "#f8faf9", borderRadius: "8px", border: "1px solid #dfe7df", marginBottom: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Analyze a Website</h2>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <input type="url" required placeholder="https://www.example.com" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1, padding: "0.6rem", border: "1px solid #cad8cd", borderRadius: "4px" }} />
        <button type="submit" disabled={status?.loading} style={{ padding: "0.6rem 1.2rem", background: "#17342d", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>
          {status?.loading ? "Registering..." : "Analyze"}
        </button>
      </form>
      {status?.error && <div style={{ color: "#d25c3b", marginTop: "0.8rem", fontSize: "0.9rem" }}>{status.error}</div>}
      {status?.success && (
        <div style={{ background: "#e8f4eb", color: "#1b4d32", padding: "1rem", borderRadius: "4px", marginTop: "1rem", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>
          <strong>{status.message}</strong>
        </div>
      )}
    </div>
  );
}
