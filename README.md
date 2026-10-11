# UXLens

UXLens is a privacy-first UX analytics tool combining a lightweight Chrome extension, a high-throughput Express and PostgreSQL backend, a real-time React dashboard, an MCP (Model Context Protocol) server, and an interactive voice assistant. It automatically captures real user friction patterns—specifically dead clicks, repeated clicks, hesitation, and backtracking—maps each pattern directly to a Nielsen usability heuristic, and answers diagnostic questions through conversational speech. Built for the **Amazon Developer Hackathon (Alexa+ track)**.

> [!NOTE]
> **Simulated Alexa+ Experience**: The voice experience in UXLens is **simulated in the browser** using the Web Speech API (SpeechRecognition and SpeechSynthesis) connected to our custom MCP server (`/ask` and `/mcp` endpoints), rather than running on physical Amazon Echo hardware.

---

## 1. Live Demos

You can try UXLens immediately without running servers locally:

| Service | Live URL | Status / Notes |
|---|---|---|
| **Web Dashboard** | [https://ux-lens-sooty.vercel.app](https://ux-lens-sooty.vercel.app) | Production frontend on Vercel |
| **Backend API** | [https://uxlens-5kcw.onrender.com](https://uxlens-5kcw.onrender.com) | Health check at [`/health`](https://uxlens-5kcw.onrender.com/health) |
| **MCP Server** | [https://uxlens-mcp.onrender.com/mcp](https://uxlens-mcp.onrender.com/mcp) | Health check at [`/health`](https://uxlens-mcp.onrender.com/health), voice API at `/ask` |

> [!WARNING]
> **Free-Tier Cold Starts**: The backend and MCP servers are hosted on Render's free tier. If the services have been idle, the initial request can take 40 to 60 seconds to spin up.

---

## 2. Quick Start (Using the Hosted Version)

To start analyzing user friction on any website, you only need to download the repository and load the Chrome extension.

### Step 1: Clone the Repository
```bash
git clone https://github.com/ItsAbir005/UXLens.git
cd UXLens
```

### Step 2: Install the Chrome Extension
1. Open Google Chrome and go to `chrome://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `extension/` directory inside this repository.
5. *Note*: Whenever you update extension code in the future, click the circular reload button on the UXLens extension card and refresh open browser tabs.

### Step 3: Pair a Website with a Project
1. Open the hosted dashboard at [https://ux-lens-sooty.vercel.app](https://ux-lens-sooty.vercel.app).
2. Under **Analyze a Website**, enter the URL of the site you want to test (for example, `https://news.ycombinator.com` or `https://example.com`) and click **Analyze**.
3. > [!IMPORTANT]
   > **60-Second Pairing Window**: Within 60 seconds of clicking Analyze, open the target website in another browser tab (or refresh it if already open). The extension queries the backend, retrieves an ingestion key, and pairs the tab with the project. If you miss the 60-second window, simply click **Analyze** again.

### Step 4: Interact with the Website
Browse the target website naturally in that tab:
- Click buttons, tabs, and links.
- Navigate across pages and use the browser's Back button.
- Rapidly re-click slow elements or pause/hover over options to generate realistic behavioral signals.

### Step 5: View Metrics on the Dashboard
Return to the UXLens dashboard and click **Refresh Data**:
- **UX Health Score**: A 0–100 score reflecting friction intensity per recorded session.
- **Signal Overview**: Occurrence breakdown of repeated clicks, dead clicks, hesitation, and backtracking.
- **Top Problematic Elements**: Cards detailing flagged targets with their associated **Nielsen Heuristic badge** (e.g., `H1 · Visibility of system status`) and actionable **Suggested fix**.
- **User Journeys**: Visual flow of visited pages showing where users encountered friction along the path.

### Step 6: Use the Voice Assistant ("Talk to UXLens")
Near the top of the Overview page, locate the **Talk to UXLens** voice panel:
1. Click **🎤 Speak** (allow microphone permissions in Chrome) or type a question into the text box and click **Ask**.
2. Example questions you can ask:
   - *"How is my site doing?"*
   - *"What are the problems?"*
   - *"How can I improve?"*
   - *"Why is backtracking bad?"*
3. The assistant speaks the answer using speech synthesis (click **⏹ Stop** at any time to silence it).
4. **AI vs. Rules indicator**:
   - If `GEMINI_API_KEY` is configured on the MCP server, answers are dynamically written by Gemini from real project interaction context (`Answered by AI from your UXLens data`).
   - If the key is omitted or the API times out, the assistant seamlessly answers using deterministic heuristics (`Answered by rules`).

---

## 3. Running Everything Locally (For Developers)

If you prefer to run the entire stack on your local machine:

### Prerequisites
- **Node.js**: Version 20 or newer (Node.js 22+ recommended; see `backend/package.json` and `frontend/package.json`).
- **PostgreSQL**: A running local Postgres instance or a cloud Postgres database (such as Supabase or Neon).

---

### Step 1: Backend Setup (`backend/`)
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Copy the environment variables:
   ```bash
   cp .env.example .env
   ```
3. Edit `backend/.env` with your Postgres connection string:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/uxlens?schema=public"
   DIRECT_URL="postgresql://user:password@localhost:5432/uxlens?schema=public"
   ```
   *(For Supabase, use the pooled connection for `DATABASE_URL` and direct connection for `DIRECT_URL`).*
4. Install dependencies and run Prisma migrations:
   ```bash
   npm install
   npm run prisma:generate
   npm run prisma:migrate
   ```
5. Start the backend:
   ```bash
   npm run dev
   ```
   The backend will run on port **`4000`** (or `PORT`). Verify health at `http://localhost:4000/health`.

---

### Step 2: Frontend Setup (`frontend/`)
1. In a new terminal, navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Copy the environment variables:
   ```bash
   cp .env.example .env
   ```
3. Configure `frontend/.env`:
   ```env
   VITE_API_BASE_URL=http://localhost:4000
   VITE_MCP_URL=http://localhost:5000/mcp
   ```
4. Install dependencies and start the Vite dev server:
   ```bash
   npm install
   npm run dev
   ```
   The dashboard will run on **`http://localhost:5173`**.

---

### Step 3: MCP Server Setup (`mcp-server/`)
1. In a new terminal, navigate to the MCP directory:
   ```bash
   cd mcp-server
   ```
2. Copy the environment variables:
   ```bash
   cp .env.example .env
   ```
3. Configure `mcp-server/.env`:
   ```env
   BACKEND_URL=http://localhost:4000
   UXLENS_DEFAULT_PROJECT_ID=<your-project-id-from-database>
   GEMINI_API_KEY=
   GEMINI_MODEL=gemini-2.0-flash
   ```
   *(Note: `GEMINI_API_KEY` is optional; if omitted, the assistant falls back to rule-based answers).*
4. Install dependencies and start the server:
   ```bash
   npm install
   npm start
   ```
   The MCP server runs on port **`5000`** (or `PORT`). Endpoints:
   - MCP protocol: `http://localhost:5000/mcp`
   - AI voice endpoint: `http://localhost:5000/ask`
   - Health check: `http://localhost:5000/health`

---

### Step 4: Point the Extension to Local Backend
By default, the Chrome extension points to the hosted Render backend. To point it to your local backend:
1. Open `extension/src/config.js` and change `defaultBackendUrl` on line 3:
   ```javascript
   // extension/src/config.js:3
   const defaultBackendUrl = "http://localhost:4000";
   ```
2. Go to `chrome://extensions` and click the reload icon on the UXLens extension.
3. Refresh any open tabs to apply the new endpoint.

---

## 4. Architecture

```mermaid
flowchart TD
  subgraph Client_Browser ["User Browser"]
    Ext["Chrome Extension (MV3)<br/>content.js + background.js"]
    Dash["Web Dashboard (React + Vite)<br/>App.jsx"]
    Voice["Voice Panel (Talk to UXLens)<br/>VoicePanel.jsx"]
  end

  subgraph Backend_Services ["Backend Services"]
    Backend["Backend API (Express 5)<br/>server.js + heuristics.js"]
    DB[("PostgreSQL Database<br/>Prisma ORM")]
    MCP["MCP Server (Express 5)<br/>server.js"]
  end

  subgraph External_Services ["External APIs"]
    Gemini["Google Gemini REST API<br/>gemini-2.0-flash"]
  end

  Ext -->|"POST /api/sites/resolve<br/>POST /api/events"| Backend
  Dash -->|"POST /api/sites/analyze<br/>GET /api/projects/:id/*"| Backend
  Backend <--> DB
  Voice -->|"POST /ask (AI Voice)<br/>POST /mcp (JSON-RPC 2.0)"| MCP
  MCP -->|"requestBackend()<br/>GET /api/projects/:id/*"| Backend
  MCP -.->|"generateContent (optional)"| Gemini
```

### Component Overview

| Component | Directory | Stack | Production Deployment |
|---|---|---|---|
| **Collector Extension** | `extension/` | Manifest V3, Chrome Storage & Alarms | Local Chrome Unpacked |
| **Backend API** | `backend/` | Node.js, Express 5, Prisma ORM, PostgreSQL | Render Web Service |
| **Web Dashboard** | `frontend/` | React 19, Vite 7 | Vercel |
| **MCP Server** | `mcp-server/` | Express 5, Model Context Protocol SDK | Render Web Service |

### Registered MCP Tools (`mcp-server/server.js`)
- `ping`: Verifies MCP server liveness.
- `get_ux_summary`: High-level friction metrics and aggregate health status.
- `get_ux_problems`: Top 10 detected friction areas sorted by severity and occurrences.
- `get_problem_details`: Detailed evidence for a specific element or friction type.
- `get_design_suggestions`: Top 3 issues mapped to Nielsen usability heuristics and suggested fixes.
- `get_session_timeline`: Recent sequence of significant user actions across a session.

---

## 5. Privacy by Design

UXLens is built strictly around client-side sanitization before any data leaves the browser. Verify this implementation directly in [`extension/src/event-sanitizer.js`](file:///c:/Users/ABIR%20MAITY/OneDrive/Desktop/hack/extension/src/event-sanitizer.js) and [`extension/src/content.js`](file:///c:/Users/ABIR%20MAITY/OneDrive/Desktop/hack/extension/src/content.js).

### What IS Collected:
- **Event Types**: High-level interaction categories (`page_view`, `click`, `hover`, `navigation`, `repeated_click`).
- **Sanitized Page Paths**: Clean URL paths via `safePage()`. Dynamic segments like UUIDs, numeric IDs, and long hex strings are replaced with `:id` (e.g. `/workspace/9b1deb4d-...` $\rightarrow$ `/workspace/:id`).
- **Element Tag and Role**: Generic tags (`button`, `a`) and ARIA roles (`role="button"`).
- **Safe Button Labels**: Truncated button labels (maximum 80 characters) strictly checked against a sensitive pattern regex.
- **Timestamps**: Timing deltas to calculate hover-to-click hesitation and click intervals.
- **Ephemeral Session ID**: A per-tab UUID persisted in `sessionStorage` (discarded when the tab is closed).

### What is NEVER Collected:
- **No Keystrokes or Typed Text**: The extension does not attach `keydown` or `input` listeners.
- **No Form Data or Input Values**: Text inputs, passwords, select menus, and textareas are never read.
- **No Link Inner Text**: For `<a>` tags, inner labels are completely stripped out to prevent capturing sensitive link names.
- **No Query Strings or URL Fragments**: Query parameters (`?token=...`) and hashes (`#...`) are never transmitted in event payloads.
- **No Sensitive Strings**: Any label matching credentials, passwords, tokens, emails, phone numbers, addresses, credit cards, or API keys is dropped immediately.
- **No Iframes**: Embedded iframes are rejected at script startup (`if (window.top !== window) return;`).

---

## 6. Nielsen Usability Heuristic Mapping

UXLens maps detected behavioral friction directly to Jakob Nielsen's 10 Usability Heuristics via [`backend/src/heuristics.js`](file:///c:/Users/ABIR%20MAITY/OneDrive/Desktop/hack/backend/src/heuristics.js):

| Signal | Heuristic | Name | Detection Rationale | Suggested Fix |
|---|---|---|---|---|
| **Dead Click** | **H1** | *Visibility of system status* | The click gave no visible feedback (no DOM mutation or navigation within 1s). | Add an immediate pressed/loading state or make clear the element is not interactive. |
| **Repeated Clicks** | **H1** | *Visibility of system status* | Multiple rapid clicks indicate uncertainty whether the action registered. | Show immediate feedback such as a spinner or a disabled button state. |
| **Hesitation** | **H6** | *Recognition rather than recall* | Prolonged hover-to-click delay (> 3s) indicates uncertainty before committing. | Use a plain-language label and add a descriptive tooltip. |
| **Backtracking** | **H3** | *User control and freedom* | The user immediately retraced their path back to an earlier page. | Add clear breadcrumb navigation and simplify the menu structure. |

> [!NOTE]
> **Heuristics vs. Verdicts**: These mappings are automated heuristic suggestions derived from interaction signals, not a definitive human design review. They pinpoint where user expectations likely diverge from interface behavior.

---

## 7. Known Limitations

- **Free-Tier Spin-Down**: Render free web services spin down after 15 minutes of inactivity. Initial requests after idle may take up to 60 seconds.
- **Public Project Identifiers**: Project data endpoints are currently keyed by Project ID without user login authentication.
- **60-Second Pairing Window**: The pairing mechanism between the dashboard and the extension relies on a 60-second window after clicking "Analyze".
- **Simulated Voice Experience**: The "Talk to UXLens" assistant is executed in-browser using the Web Speech API and our MCP backend; it is not an official Alexa Skill running on Amazon Echo hardware.
- **Top-Frame Scope**: Hidden iframes and cross-origin embed frames are excluded from tracking for privacy and security.
