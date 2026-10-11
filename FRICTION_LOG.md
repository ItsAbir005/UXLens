# UXLens Friction Log

Developer-experience friction we hit while building UXLens for the Amazon Developer Hackathon (Alexa+ track). Each entry lists the task, steps, expected vs. actual result, severity, workaround and a suggestion.

## 1. Finding out what the Alexa+ track accepts without devices or paid services
- **Task:** Choose an approach for the Alexa+ track with no Alexa hardware and no paid cloud services.
- **Steps:** Looked for what a valid submission must contain; tried to work out whether a classic Alexa skill, an MCP-based experience, or a simulated experience would count.
- **Expected:** A clear page stating the accepted build options and what "working demo" means.
- **Actual:** We had to rely on a third-party listing to confirm that Agent Skills, MCP-based experiences and simulated Alexa+ experiences are accepted. We first assumed a classic skill hosted on AWS was required and that it was not free.
- **Severity:** Medium (it affected our architecture decision).
- **Workaround:** Built an MCP server and a simulated Alexa+-style voice panel (Web Speech API calling our MCP tools).
- **Suggestion:** Put the accepted build options, a free-tier path and a no-hardware path on the main hackathon page.

## 2. Returning structured results from an MCP tool
- **Task:** Return the top design suggestions from a tool as a list.
- **Steps:** Returned a bare array as the tool's structured result.
- **Expected:** Any JSON value is accepted.
- **Actual:** Structured results are expected to be an object, so some clients can reject an array result.
- **Severity:** Medium.
- **Workaround:** Wrapped the list as { summary, suggestions, spoken }.
- **Suggestion:** A clearer error from the SDK, and a note in the docs that structured results must be objects.

## 3. Calling an MCP server from a browser
- **Task:** Let the dashboard's voice panel call our MCP server over HTTPS.
- **Steps:** Called POST /mcp from the browser with JSON-RPC.
- **Expected:** It works like a normal API call.
- **Actual:** The browser's CORS preflight (OPTIONS) failed because the server had no handler, and the default Streamable HTTP response was an event stream rather than plain JSON.
- **Severity:** High (blocked the voice demo).
- **Workaround:** Answered OPTIONS with 204, allowed the MCP headers (Accept, Mcp-Protocol-Version, Mcp-Session-Id), and enabled JSON responses on the transport.
- **Suggestion:** Add a browser-client example (CORS headers and JSON response mode) to the Streamable HTTP documentation.

## 4. Free-tier hosting cold starts and a crashed deploy
- **Task:** Host the backend and the MCP server for judges at no cost.
- **Steps:** Deployed both on a free web-service tier and tested after idle periods.
- **Expected:** Fast responses and a clear failure reason when a deploy breaks.
- **Actual:** The first request after idle can take up to a minute, which is too slow for a voice interaction. One bad deploy crashed on startup (a database client created without its adapter); the previous version kept running, which hid the failure for a while.
- **Severity:** Medium.
- **Workaround:** Health-check pings to keep services warm, and small verified changes with a diff check before every push.
- **Suggestion:** Surface startup-crash reasons more prominently in the dashboard and offer a warm-start option on free tiers.

## 5. Chrome extension (Manifest V3) lifecycle
- **Task:** Capture user interactions reliably in a Manifest V3 extension while developing it.
- **Steps:** Reloaded the unpacked extension while pages were open and sent events from content scripts to the service worker.
- **Expected:** Old pages keep working or fail quietly.
- **Actual:** Orphaned content scripts raised "Extension context invalidated" and "The message port closed before a response was received", which looked like real failures but were not, and events could race when many arrived at once.
- **Severity:** Medium.
- **Workaround:** Context-validity checks, an AbortController to shut down old listeners, always replying to messages, and a storage-backed queue with retries.
- **Suggestion:** Clearer docs for reload behaviour of unpacked extensions and for messaging patterns that avoid unchecked runtime errors.
