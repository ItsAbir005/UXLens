import { useEffect, useState } from "react";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

export default function App() {
  const [health, setHealth] = useState({ status: "checking", database: "checking" });

  useEffect(() => {
    fetch(`${backendUrl}/health`)
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth({ status: "offline", database: "unavailable" }));
  }, []);

  return (
    <main>
      <p className="eyebrow">UXLens / Phase 1</p>
      <h1>Workspace foundation.</h1>
      <p className="lede">React, Express, Prisma, PostgreSQL, and MCP are running as one local system.</p>
      <section className="status" aria-live="polite">
        <div>
          <span>Backend</span>
          <strong>{health.status}</strong>
        </div>
        <div>
          <span>Database</span>
          <strong>{health.database}</strong>
        </div>
        <div>
          <span>Projects</span>
          <strong>{health.projectCount ?? "-"}</strong>
        </div>
      </section>
    </main>
  );
}
