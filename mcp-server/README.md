# UXLens MCP Server

Model Context Protocol (MCP) server for UXLens UX friction intelligence.

## Deploying to Render

To deploy this MCP server on Render as a Web Service:

- **Root Directory**: `mcp-server`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment Variables**:
  - `BACKEND_URL`: URL of the UXLens backend API (e.g., `https://uxlens-5kcw.onrender.com`)
  - `UXLENS_DEFAULT_PROJECT_ID`: (Optional) Default project ID to use when no `projectId` is passed to tools
  - `UXLENS_PROJECT_INGESTION_KEY`: (Optional) Ingestion key if authentication is required
  - `GEMINI_API_KEY`: (Optional) Gemini API key for AI-generated answers via `/ask` (falls back to rules if omitted)
  - `GEMINI_MODEL`: (Optional) Model name (defaults to `gemini-2.0-flash`)
