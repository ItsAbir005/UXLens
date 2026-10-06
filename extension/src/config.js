(() => {
  const defaultBackendUrl = "http://localhost:4000";

  const normalizeBackendUrl = (value) => {
    const candidate = String(value || "").trim().replace(/\/+$/, "");
    if (!candidate) return defaultBackendUrl;
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Backend URL must use HTTP or HTTPS.");
    }
    return parsed.origin;
  };

  const readConfig = async () => {
    const config = await chrome.storage.local.get({ backendUrl: defaultBackendUrl, projectId: "", ingestionKey: "" });
    return {
      backendUrl: normalizeBackendUrl(config.backendUrl),
      projectId: String(config.projectId || "").trim(),
      ingestionKey: String(config.ingestionKey || "").trim()
    };
  };

  const saveConfig = async ({ backendUrl, projectId, ingestionKey }) => {
    const normalized = {
      backendUrl: normalizeBackendUrl(backendUrl),
      projectId: String(projectId || "").trim(),
      ingestionKey: String(ingestionKey || "").trim()
    };
    await chrome.storage.local.set(normalized);
    return normalized;
  };

  const clearConfig = () => chrome.storage.local.clear();

  globalThis.UXLensConfig = { defaultBackendUrl, normalizeBackendUrl, readConfig, saveConfig, clearConfig };
})();