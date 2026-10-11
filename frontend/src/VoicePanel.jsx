import { useState, useRef, useEffect } from "react";

const mcpUrl = import.meta.env.VITE_MCP_URL || "https://uxlens-mcp.onrender.com/mcp";
const baseUrl = mcpUrl.replace(/\/mcp\/?$/, "");

export default function VoicePanel({ projectId, topProblemType }) {
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [exchanges, setExchanges] = useState([]);
  const recognitionRef = useRef(null);

  const SpeechRecognition = typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, []);

  const speak = (text) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  };

  const callTool = async (name, args = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name, arguments: args }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`MCP server returned HTTP ${response.status}`);
      }

      const resData = await response.json();
      if (resData.error) {
        throw new Error(resData.error.message || "MCP tool call failed.");
      }

      const result = resData.result || {};
      let spokenText = result.structuredContent?.spoken;
      if (!spokenText && result.content?.[0]?.text) {
        const raw = result.content[0].text;
        try {
          const parsed = JSON.parse(raw);
          spokenText = parsed?.spoken || parsed?.summary || raw;
        } catch {
          spokenText = raw;
        }
      }

      return {
        spoken: spokenText || "I received a response, but no speech summary was available."
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error("Request to UXLens MCP server timed out after 20 seconds.");
      }
      throw new Error(err.message || "Could not connect to UXLens MCP server.");
    }
  };

  const routeIntent = (text) => {
    const q = text.toLowerCase();
    if (/(problem|issue|wrong|friction)/.test(q)) {
      return { tool: "get_ux_problems", args: { ...(projectId ? { projectId } : {}) } };
    }
    if (/(fix|suggest|improve|recommend|heuristic|design)/.test(q)) {
      return { tool: "get_design_suggestions", args: { ...(projectId ? { projectId } : {}) } };
    }
    if (/(why|evidence|detail)/.test(q)) {
      return { tool: "get_problem_details", args: { problemType: topProblemType || "dead_click", ...(projectId ? { projectId } : {}) } };
    }
    if (/(how|doing|health|score|summary|overall)/.test(q)) {
      return { tool: "get_ux_summary", args: { ...(projectId ? { projectId } : {}) } };
    }
    return null;
  };

  const handleQuery = async (queryText) => {
    const cleanQuery = queryText.trim();
    if (!cleanQuery) return;

    setErrorMessage("");
    setLoading(true);

    // Try POST /ask first
    try {
      const askRes = await fetch(`${baseUrl}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: cleanQuery })
      });
      if (askRes.ok) {
        const askData = await askRes.json();
        if (askData.answer) {
          const source = askData.source || "rules";
          const exchange = {
            userSaid: cleanQuery,
            tool: source === "ai" ? "Gemini AI" : "Rules",
            answer: askData.answer,
            source
          };
          setExchanges((prev) => [exchange, ...prev].slice(0, 5));
          speak(askData.answer);
          setLoading(false);
          return;
        }
      }
    } catch {
      // /ask failed or unavailable, fall back to MCP tool flow below
    }

    // Fallback: existing MCP tool routing flow
    const intent = routeIntent(cleanQuery);

    if (!intent) {
      const helpAnswer = "I can summarize overall UX health, list friction problems, give design suggestions, or explain why users struggle. What would you like to know?";
      setExchanges((prev) => [
        { userSaid: cleanQuery, tool: "Help", answer: helpAnswer, source: "rules" },
        ...prev
      ].slice(0, 5));
      setLoading(false);
      speak(helpAnswer);
      return;
    }

    try {
      const { spoken } = await callTool(intent.tool, intent.args);
      setExchanges((prev) => [
        { userSaid: cleanQuery, tool: intent.tool, answer: spoken, source: "rules" },
        ...prev
      ].slice(0, 5));
      speak(spoken);
    } catch (err) {
      const errorAnswer = `Error: ${err.message}`;
      setErrorMessage(err.message);
      setExchanges((prev) => [
        { userSaid: cleanQuery, tool: intent.tool, answer: errorAnswer, source: "rules" },
        ...prev
      ].slice(0, 5));
      speak("Sorry, I could not complete that request with the UXLens MCP server.");
    } finally {
      setLoading(false);
    }
  };

  const toggleMic = () => {
    if (!SpeechRecognition) {
      setErrorMessage("Speech recognition is not supported in this browser. Please use the text input below.");
      return;
    }

    if (isListening) {
      try { recognitionRef.current?.stop(); } catch {}
      setIsListening(false);
      return;
    }

    stopSpeaking();
    setErrorMessage("");

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (e) => {
        setIsListening(false);
        if (e.error !== "no-speech") {
          setErrorMessage(`Microphone error: ${e.error}`);
        }
      };
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setInputText(transcript);
          handleQuery(transcript);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setErrorMessage("Failed to start speech recognition.");
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;
    const text = inputText;
    setInputText("");
    handleQuery(text);
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #dfe7df", borderRadius: "8px", padding: "1.25rem 1.5rem", marginBottom: "2rem", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.15rem", color: "#17342d", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span>🎙️</span> Talk to UXLens
          </h2>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "#627970" }}>
            Simulated Alexa+-style voice experience · powered by UXLens MCP
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={toggleMic}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              background: isListening ? "#a3402d" : "#17342d",
              color: "#fff",
              border: "none",
              padding: "0.45rem 0.85rem",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 600,
              fontFamily: "inherit",
              transition: "background 0.2s"
            }}
          >
            <span>{isListening ? "🔴 Listening..." : "🎤 Speak"}</span>
          </button>
          {isSpeaking && (
            <button
              type="button"
              onClick={stopSpeaking}
              style={{
                background: "#fbe6df",
                color: "#a3402d",
                border: "1px solid #efc6bb",
                padding: "0.45rem 0.85rem",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 600,
                fontFamily: "inherit"
              }}
            >
              ⏹ Stop
            </button>
          )}
        </div>
      </div>

      {!SpeechRecognition && (
        <div style={{ padding: "0.5rem 0.75rem", background: "#fff0d7", border: "1px solid #f9d8a6", borderRadius: "4px", fontSize: "0.75rem", color: "#986021", marginBottom: "0.75rem" }}>
          Speech recognition is not supported in this browser. You can type your question in the text box below.
        </div>
      )}

      {errorMessage && (
        <div style={{ padding: "0.5rem 0.75rem", background: "#fbe6df", border: "1px solid #efc6bb", borderRadius: "4px", fontSize: "0.75rem", color: "#a3402d", marginBottom: "0.75rem" }}>
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleFormSubmit} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask about UX health, problems, suggestions, or evidence..."
          disabled={loading}
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            borderRadius: "4px",
            border: "1px solid #cad8cd",
            fontSize: "0.85rem",
            fontFamily: "inherit",
            outline: "none"
          }}
        />
        <button
          type="submit"
          disabled={loading || !inputText.trim()}
          style={{
            background: "#e6c96e",
            color: "#17342d",
            border: "none",
            padding: "0.5rem 1.1rem",
            borderRadius: "4px",
            fontWeight: 600,
            cursor: loading || !inputText.trim() ? "not-allowed" : "pointer",
            fontSize: "0.85rem",
            opacity: loading || !inputText.trim() ? 0.6 : 1,
            fontFamily: "inherit"
          }}
        >
          {loading ? "Thinking..." : "Ask"}
        </button>
      </form>

      {exchanges.length > 0 && (
        <div>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#789087", fontWeight: 700, marginBottom: "0.4rem", fontFamily: "'DM Mono', monospace" }}>
            Recent Conversation
          </div>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {exchanges.map((item, index) => (
              <div
                key={index}
                style={{
                  background: "#f8faf8",
                  border: "1px solid #edf1ed",
                  borderRadius: "4px",
                  padding: "0.6rem 0.85rem",
                  fontSize: "0.8rem",
                  lineHeight: 1.45
                }}
              >
                <div style={{ color: "#17342d", marginBottom: "0.15rem" }}>
                  <strong>You said:</strong> "{item.userSaid}"
                </div>
                <div style={{ color: "#627970", font: "500 0.7rem 'DM Mono', monospace", marginBottom: "0.15rem" }}>
                  Tool: <span style={{ color: "#2d6a4f" }}>{item.tool}</span>
                </div>
                <div style={{ color: "#304d42", marginBottom: "0.25rem" }}>
                  <strong>Answer:</strong> {item.answer}
                </div>
                <div style={{ fontSize: "0.7rem", color: item.source === "ai" ? "#2d6a4f" : "#627970", fontStyle: "italic" }}>
                  {item.source === "ai" ? "Answered by AI from your UXLens data" : "Answered by rules"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
