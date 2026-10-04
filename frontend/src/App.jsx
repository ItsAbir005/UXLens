import { useEffect, useState } from "react";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const problemCards = [
  { type: "repeated_click", label: "Repeated clicks", tone: "red" },
  { type: "dead_click", label: "Dead clicks", tone: "orange" },
  { type: "hesitation", label: "Hesitation", tone: "yellow" },
  { type: "backtracking", label: "Backtracking", tone: "blue" }
];

const readJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The dashboard could not load this data.");
  return response.json();
};

const eventLabel = (event) => {
  const element = event.element || {};
  const name = element.text || element.id || element.role || element.tag;
  if (event.type === "page_view") return "Page viewed";
  if (event.type === "click") return `Clicked ${name || "an element"}`;
  if (event.type === "repeated_click") return `Repeated click on ${name || "an element"}`;
  if (event.type === "navigation") return `Navigated to ${event.metadata?.to || event.page}`;
  if (event.type === "hover") return `Hovered ${name || "an element"}`;
  if (event.type === "scroll") return `Scrolled to ${event.metadata?.percentage ?? 0}%`;
  return event.type;
};

const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString([], {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
});

export default function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    readJson(`${backendUrl}/api/projects`)
      .then((data) => { setProjects(data); setSelectedProjectId(data[0]?.id || ""); })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoadingProjects(false));
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
  }, [selectedProjectId]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">U</span><span>UXLens</span></div>
        <div className="sidebar-label">Workspace</div>
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
          <a href="#timeline"><span className="nav-icon">≡</span>Session timeline</a>
        </nav>
        <div className="sidebar-footer"><span className="status-dot" />Tracking connected</div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div><p className="kicker">Product experience / Overview</p><h1>Understand where users pause.</h1></div>
          <div className="topbar-project">{selectedProject?.website || "Select a project"}</div>
        </header>

        {error && <div className="alert" role="alert">{error}</div>}
        {loadingProjects || loadingDashboard ? <div className="state-panel"><span className="loader" />Loading your experience data...</div> : null}
        {!loadingProjects && !loadingDashboard && !error && projects.length === 0 && <div className="state-panel empty-state"><strong>No project data yet</strong><span>Add a project and install the tracker to see UX signals here.</span></div>}

        {!loadingProjects && !loadingDashboard && dashboard && <>
          <section id="overview" className="summary-section">
            <div className="section-heading"><div><p className="kicker">Signal overview</p><h2>UX problems</h2></div><span className="updated-label">{dashboard.problems.length} detected signals</span></div>
            <div className="problem-summary-grid">
              {problemCards.map((card) => <div className={`summary-card ${card.tone}`} key={card.type}><span className="signal-dot" /><span className="summary-label">{card.label}</span><strong>{dashboard.summary[card.type] || 0}</strong><span className="summary-caption">occurrences</span></div>)}
            </div>
          </section>

          <div className="content-grid">
            <section id="problems" className="panel problems-panel">
              <div className="panel-heading"><div><p className="kicker">Evidence-led review</p><h2>Top problematic elements</h2></div><span className="count-badge">{dashboard.problems.length}</span></div>
              {dashboard.problems.length === 0 ? <div className="panel-empty">No friction signals detected for this project yet.</div> : <div className="problem-list">{dashboard.problems.map((problem) => <ProblemCard key={problem.id} problem={problem} />)}</div>}
            </section>

            <section id="timeline" className="panel timeline-panel">
              <div className="panel-heading"><div><p className="kicker">Latest activity</p><h2>Session timeline</h2></div><span className="count-badge">{events.length}</span></div>
              {events.length === 0 ? <div className="panel-empty">Events will appear when the tracker receives activity.</div> : <div className="timeline">{events.map((event) => <div className="timeline-row" key={event.id}><time>{formatTime(event.timestamp)}</time><span className={`timeline-marker ${event.type}`} /><div><strong>{eventLabel(event)}</strong><span>{event.page}</span></div></div>)}</div>}
            </section>
          </div>
        </>}
      </main>
    </div>
  );
}

function ProblemCard({ problem }) {
  return <article className="problem-card"><div className="problem-card-top"><span className={`severity ${problem.severity}`}>{problem.severity}</span><span className="occurrences">{problem.occurrences} occurrences</span></div><h3>{problem.title}</h3><div className="problem-target"><strong>{problem.element}</strong><span>{problem.page}</span></div><div className="evidence"><span>Evidence</span><ul>{problem.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div></article>;
}
