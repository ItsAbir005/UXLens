import { useEffect, useState } from "react";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const mcpUrl = import.meta.env.VITE_MCP_URL || "http://localhost:5000";

export default function App() {
  const [health, setHealth] = useState({ backend: "checking", database: "checking", mcp: "checking" });

  useEffect(() => {
    const readHealth = (url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error("Health check failed");
      return response.json();
    });

    Promise.allSettled([readHealth(`${backendUrl}/health`), readHealth(`${mcpUrl}/health`)]).then(([backendResult, mcpResult]) => {
      const backendHealth = backendResult.status === "fulfilled" ? backendResult.value : {};
      const mcpHealth = mcpResult.status === "fulfilled" ? mcpResult.value : {};
      setHealth({
        backend: backendHealth.status === "ok" ? "connected" : "unavailable",
        database: backendHealth.database === "connected" ? "connected" : "unavailable",
        mcp: mcpHealth.status === "ok" ? "connected" : "unavailable"
      });
    });
  }, []);

  return (
    <main>
      <p className="eyebrow">UXLens / Phase 1</p>
      <h1>Workspace foundation.</h1>
      <p className="lede">React, Express, Prisma, PostgreSQL, and MCP are running as one local system.</p>
      <section className="status" aria-live="polite">
        <div>
          <span>Backend</span>
          <strong>Backend: {health.backend === "connected" ? "Connected ✓" : health.backend}</strong>
        </div>
        <div>
          <span>Database</span>
          <strong>Database: {health.database === "connected" ? "Connected ✓" : health.database}</strong>
        </div>
        <div>
          <span>MCP</span>
          <strong>MCP: {health.mcp === "connected" ? "Connected ✓" : health.mcp}</strong>
        </div>
      </section>
    </main>
  );
}
