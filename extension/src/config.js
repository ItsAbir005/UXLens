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
    const siteData = cached[cacheKey];

    if (siteData && siteData.ingestionKey) return siteData;

    if (siteData && siteData.failedAt) {
      const elapsed = Date.now() - siteData.failedAt;
      const isNotRegistered = siteData.reason === "NOT_REGISTERED" || siteData.reason === 404;
      const isRateLimit = siteData.reason === 429;
      const cooldown = (isNotRegistered || isRateLimit) ? 60000 : 15000;
      
      if (elapsed < cooldown) {
        if (isNotRegistered) {
          const err = new Error("Site not registered");
          err.code = "NOT_REGISTERED";
          throw err;
        }
        const err = new Error(`Cooled down. Previous failure: ${siteData.reason}`);
        err.code = "COOLED_DOWN";
        throw err;
      }
    }

    // Prevent spamming the resolve endpoint and hitting the 10-req/min rate limit if not paired
    if (siteData && !siteData.failedAt && siteData.lastChecked && (Date.now() - siteData.lastChecked < 10000)) {
      return siteData;
    }

    let response;
    try {
      response = await fetch(`${backendUrl}/api/sites/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin })
      });
    } catch (networkErr) {
      await chrome.storage.local.set({ [cacheKey]: { failedAt: Date.now(), reason: "network" } });
      throw new Error(`Network failure: ${networkErr.message}`);
    }

    if (!response.ok) {
      let errText = response.statusText;
      try {
        const errJson = await response.json();
        errText = errJson.error || errText;
      } catch {}
      
      await chrome.storage.local.set({ [cacheKey]: { failedAt: Date.now(), reason: response.status } });
      
      if (response.status === 404) {
        const err = new Error(`HTTP 404 - ${errText}`);
        err.code = "NOT_REGISTERED";
        throw err;
      }

      throw new Error(`HTTP ${response.status} - ${errText}`);
    }
    
    let data;
    try {
      data = await response.json();
    } catch {
      await chrome.storage.local.set({ [cacheKey]: { failedAt: Date.now(), reason: "invalid_json" } });
      throw new Error("Invalid response: not valid JSON");
    }

    const siteConfig = { 
      projectId: data.id, 
      ingestionKey: data.ingestionKey,
      lastChecked: Date.now()
    };
    await chrome.storage.local.set({ [cacheKey]: siteConfig });
    return siteConfig;
  };

  const clearConfig = () => chrome.storage.local.clear();

  globalThis.UXLensConfig = { defaultBackendUrl, normalizeBackendUrl, readConfig, saveConfig, resolveSite, clearConfig };
})();