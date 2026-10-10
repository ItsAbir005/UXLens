importScripts("logger.js", "config.js", "event-queue.js");

const log = (stage, data) => globalThis.UXLensLogger && globalThis.UXLensLogger.log("background", stage, data);

const sessionCache = new Map();
const sessionStoragePrefix = "uxlens-session:";

const sessionStorageArea = () => chrome.storage.session || chrome.storage.local;

async function getSessionId(tabId, projectId) {
  const key = `${sessionStoragePrefix}${tabId}:${projectId}`;
  if (sessionCache.has(key)) return sessionCache.get(key);
  const stored = await sessionStorageArea().get(key);
  const sessionId = stored[key] || crypto.randomUUID();
  sessionCache.set(key, sessionId);
  await sessionStorageArea().set({ [key]: sessionId });
  return sessionId;
}

async function removeTabSessions(tabId) {
  const keys = [...sessionCache.keys()].filter((key) => key.startsWith(`${sessionStoragePrefix}${tabId}:`));
  keys.forEach((key) => sessionCache.delete(key));
  if (keys.length) await sessionStorageArea().remove(keys);
}

async function sendToBackend(event) {
  const headers = { "Content-Type": "application/json" };
  if (event.ingestionKey) {
    headers.Authorization = `Bearer ${event.ingestionKey}`;
  }
  return fetch(`${event.backendUrl}/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(event.payload)
  });
}

const getOrigin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

// Start logging
UXLensConfig.readConfig().then(config => {
  log("sw_started", { backendUrl: config.backendUrl });
});

UXLensEventQueue.setHandler(async (eventObj) => {
  return sendToBackend(eventObj);
});

async function handleEvent(message, sender) {
  const tabId = sender.tab?.id;
  const origin = getOrigin(sender.tab?.url);
  
  if (typeof tabId !== "number") {
    log("handleEvent_early_return", { reason: "no_tab_id" });
    return;
  }
  if (!message?.event) {
    log("handleEvent_early_return", { reason: "no_event_payload" });
    return;
  }
  if (!origin) {
    log("handleEvent_early_return", { reason: "no_origin" });
    return;
  }
  
  const config = await UXLensConfig.readConfig();
  let siteConfig;
  try {
    siteConfig = await UXLensConfig.resolveSite(origin, config.backendUrl);
  } catch (e) {
    if (e.code === "NOT_REGISTERED" || e.code === "COOLED_DOWN") {
      log("handleEvent_early_return", { reason: `resolve_skipped_${e.code}` });
    } else {
      log("handleEvent_early_return", { reason: "resolve_error", error: e.message });
      console.warn("UXLens event handling aborted: resolution failed:", e.message);
    }
    return;
  }
  
  if (!siteConfig || !siteConfig.projectId || !siteConfig.ingestionKey) {
    log("handleEvent_early_return", { reason: "missing_project_or_key" });
    return;
  }

  const sessionId = await getSessionId(tabId, siteConfig.projectId);
  const currentPage = message.event.page || "/";
  const pageKey = `${sessionStoragePrefix}page:${tabId}:${siteConfig.projectId}`;
  const previousPage = (await sessionStorageArea().get(pageKey))[pageKey];
  
  const basePayload = {
    sessionId,
    projectId: siteConfig.projectId,
    type: message.event.type,
    page: currentPage,
    timestamp: Number.isFinite(message.event.timestamp) ? message.event.timestamp : Date.now(),
    element: message.event.element || {},
    metadata: { source: "extension", ...(message.event.metadata || {}) }
  };

  if (message.event.type === "page_view" && previousPage && previousPage !== currentPage) {
    UXLensEventQueue.enqueue({
      backendUrl: config.backendUrl,
      ingestionKey: siteConfig.ingestionKey,
      payload: {
        ...basePayload,
        type: "navigation",
        element: {},
        metadata: { source: "extension", from: previousPage, to: currentPage }
      }
    });
  }

  await sessionStorageArea().set({ [pageKey]: currentPage });
  UXLensEventQueue.enqueue({
    backendUrl: config.backendUrl,
    ingestionKey: siteConfig.ingestionKey,
    payload: basePayload
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("onMessage_received", { type: message?.type, tabId: sender.tab?.id, url: sender.tab?.url });
  
  if (message?.type === "configuration-status") {
    const origin = getOrigin(sender.tab?.url);
    if (!origin) {
      sendResponse({ configured: false });
      return false; 
    }
    
    UXLensConfig.readConfig()
      .then(config => {
        return UXLensConfig.resolveSite(origin, config.backendUrl).then(siteConfig => {
          sendResponse({ configured: Boolean(siteConfig && siteConfig.projectId && siteConfig.ingestionKey) });
        }).catch((e) => {
          sendResponse({ configured: false });
        });
      })
      .catch((e) => {
        sendResponse({ configured: false });
      });
    return true; 
  }
  
  if (message?.type === "uxlens-event") {
    handleEvent(message, sender).catch(e => {
      log("handleEvent_exception", { error: e.message || e });
    });
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabSessions(tabId);
});

globalThis.UXLensDebug = {
  status: async () => {
    const config = await UXLensConfig.readConfig();
    const storage = await chrome.storage.local.get(null);
    let queueLength = 0;
    if (storage.uxlens_event_queue) queueLength = storage.uxlens_event_queue.length;
    
    const sites = {};
    for (const key in storage) {
      if (key.startsWith('site_')) {
        sites[key] = { ...storage[key] };
        if (sites[key].ingestionKey) sites[key].ingestionKey = sites[key].ingestionKey.substring(0, 6) + '...';
      }
    }
    console.log("=== UXLens Debug Status ===");
    console.log("Backend URL:", config.backendUrl);
    console.log("Queue Length:", queueLength);
    console.log("Sites:", sites);
  },
  dump: async () => {
    const storage = await chrome.storage.local.get("uxlens_debug_log");
    console.log("=== UXLens Debug Log ===");
    (storage.uxlens_debug_log || []).forEach(entry => {
      console.log(`[${entry.timestamp}][${entry.where}][${entry.stage}]`, JSON.stringify(entry.data));
    });
  },
  clear: async () => {
    const storage = await chrome.storage.local.get(null);
    const keysToRemove = ["uxlens_debug_log", "uxlens_event_queue"];
    for (const key in storage) {
      if (key.startsWith('site_')) keysToRemove.push(key);
    }
    await chrome.storage.local.remove(keysToRemove);
    console.log(`Cleared ${keysToRemove.length} keys.`);
  }
};