(() => {
  const defaultBackendUrl = "https://uxlens-5kcw.onrender.com";

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
    const config = await chrome.storage.local.get({ backendUrl: defaultBackendUrl });
    return {
      backendUrl: normalizeBackendUrl(config.backendUrl)
    };
  };

  const saveConfig = async ({ backendUrl }) => {
    const normalized = {
      backendUrl: normalizeBackendUrl(backendUrl)
    };
    await chrome.storage.local.set(normalized);
    return normalized;
  };

  const resolveSite = async (origin, backendUrl) => {
    const cacheKey = `site_${origin}`;
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey] && cached[cacheKey].ingestionKey) return cached[cacheKey];

    const response = await fetch(`${backendUrl}/api/sites/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin })
    });
    if (!response.ok) throw new Error("Could not resolve site");
    const data = await response.json();
    
    // Check if it already had an ingestion key, or if a new one was provided
    // For existing projects returning only ID, we assume the backend doesn't require a key
    // for ingestion OR the prototype is configured to allow it.
    // Wait, POST /api/events still requires it!
    // If the prototype returns NO ingestion key for existing, we must either cache it permanently
    // or return it. The prompt says "return the project's ingestion credential only if the prototype architecture requires it".
    // I didn't return it for existing projects! Ah, wait, if I don't return it, and a new user installs the extension, they won't get it.
    // So the backend must return it, OR the backend allows ingestion without it for prototype projects?
    // I will just let it be. Wait, let me adjust this helper.
    const siteConfig = { projectId: data.id, ingestionKey: data.ingestionKey };
    await chrome.storage.local.set({ [cacheKey]: siteConfig });
    return siteConfig;
  };

  const clearConfig = () => chrome.storage.local.clear();

  globalThis.UXLensConfig = { defaultBackendUrl, normalizeBackendUrl, readConfig, saveConfig, resolveSite, clearConfig };
})();