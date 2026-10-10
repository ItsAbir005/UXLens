(() => {
  const log = (stage, data) => globalThis.UXLensLogger && globalThis.UXLensLogger.log("background", stage, data);
  const defaultBackendUrl = "https://uxlens-5kcw.onrender.com";
  
  const normalizeBackendUrl = (value) => {
    const candidate = String(value || "").trim().replace(/\/+$/, "");
    if (!candidate) return defaultBackendUrl;
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Backend URL must use HTTP or HTTPS.");
    }
    return parsed.href.replace(/\/+$/, "");
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

    if (siteData && Date.now() - siteData.timestamp < 3600000) {
      if (siteData.failedAt) {
        const since = Date.now() - siteData.failedAt;
        const cooldown = siteData.reason === "network" ? 15000 : 60000;
        if (since < cooldown) {
          log("resolve_cooldown_skip", { origin, reason: siteData.reason, seconds_left: Math.ceil((cooldown - since) / 1000) });
          const e = new Error("Site resolution is on cooldown");
          e.code = "COOLED_DOWN";
          throw e;
        }
      } else if (siteData.projectId) {
        log("resolve_cache_hit", { origin, age_seconds: Math.floor((Date.now() - siteData.timestamp) / 1000) });
        return siteData;
      }
    }

    let response;
    log("resolve_network_call", { url: `${backendUrl}/api/sites/resolve`, origin });
    try {
      response = await fetch(`${backendUrl}/api/sites/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin })
      });
    } catch (err) {
      await chrome.storage.local.set({ [cacheKey]: { timestamp: Date.now(), failedAt: Date.now(), reason: "network" } });
      log("resolve_network_error", { origin, error: err.message });
      throw err;
    }

    log("resolve_http_status", { origin, status: response.status });
    
    if (response.status === 429) {
      await chrome.storage.local.set({ [cacheKey]: { timestamp: Date.now(), failedAt: Date.now(), reason: 429 } });
      const e = new Error("Rate limit exceeded for site resolution");
      e.code = "COOLED_DOWN";
      throw e;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log("resolve_http_error_body", { origin, status: response.status, body: text });
      if (response.status === 404 || response.status === 403 || response.status === 401) {
        await chrome.storage.local.set({ [cacheKey]: { timestamp: Date.now(), failedAt: Date.now(), reason: response.status } });
        const e = new Error("Origin not registered or paired");
        e.code = "NOT_REGISTERED";
        throw e;
      }
      await chrome.storage.local.set({ [cacheKey]: { timestamp: Date.now(), failedAt: Date.now(), reason: "network" } });
      throw new Error(`Failed to resolve site configuration: ${response.status}`);
    }

    const { data } = await response.json();
    const resultData = {
      projectId: data.id,
      ingestionKey: data.ingestionKey,
      timestamp: Date.now()
    };
    await chrome.storage.local.set({ [cacheKey]: resultData });
    log("resolve_result", { origin, projectId: data.id, hasKey: !!data.ingestionKey });
    return resultData;
  };

  const clearConfig = () => chrome.storage.local.clear();

  globalThis.UXLensConfig = { defaultBackendUrl, normalizeBackendUrl, readConfig, saveConfig, resolveSite, clearConfig };
})();