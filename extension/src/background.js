importScripts("config.js", "event-queue.js");

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

const DEBUG = false;

UXLensEventQueue.setHandler(async (eventObj) => {
  if (DEBUG) console.log("Sending event to backend:", eventObj.payload.type);
  const response = await sendToBackend(eventObj);
  if (DEBUG) console.log("HTTP Status for", eventObj.payload.type, ":", response.status);
  return response;
});

async function handleEvent(message, sender) {
  const tabId = sender.tab?.id;
  const origin = getOrigin(sender.tab?.url);
  if (typeof tabId !== "number" || !message?.event || !origin) return;
  
  const config = await UXLensConfig.readConfig();
  let siteConfig;
  try {
    siteConfig = await UXLensConfig.resolveSite(origin, config.backendUrl);
  } catch (e) {
    if (e.code === "NOT_REGISTERED" || e.code === "COOLED_DOWN") {
      if (DEBUG) console.debug(`[UXLens DEBUG] handleEvent skipped: ${e.code} for origin=${origin} against backend=${config.backendUrl}`);
    } else {
      console.warn("UXLens event handling aborted: resolution failed:", e.message);
    }
    return;
  }
  if (!siteConfig || !siteConfig.projectId || !siteConfig.ingestionKey) return;

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
    if (DEBUG) console.log("Enqueuing navigation event:", siteConfig.projectId);
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
  if (DEBUG) console.log("Enqueuing base event:", siteConfig.projectId, basePayload.type);
  UXLensEventQueue.enqueue({
    backendUrl: config.backendUrl,
    ingestionKey: siteConfig.ingestionKey,
    payload: basePayload
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "configuration-status") {
    const origin = getOrigin(sender.tab?.url);
    if (!origin) {
      sendResponse({ configured: false });
      return false; // synchronous response
    }
    
    UXLensConfig.readConfig()
      .then(config => {
        return UXLensConfig.resolveSite(origin, config.backendUrl).then(siteConfig => {
          sendResponse({ configured: Boolean(siteConfig && siteConfig.projectId && siteConfig.ingestionKey) });
        }).catch((e) => {
          if (e.code === "NOT_REGISTERED" || e.code === "COOLED_DOWN") {
            if (DEBUG) console.debug(`[UXLens DEBUG] configuration-status skipped: ${e.code} for origin=${origin} against backend=${config.backendUrl}`);
          } else {
            console.warn("UXLens configuration failed:", e.message);
          }
          sendResponse({ configured: false });
        });
      })
      .catch((e) => {
        sendResponse({ configured: false });
      });
    return true; // asynchronous response
  }
  if (message?.type === "uxlens-event") {
    if (DEBUG) console.log("Received event from content script:", message.event?.type);
    handleEvent(message, sender).catch(e => {
      if (e.code === "NOT_REGISTERED" || e.code === "COOLED_DOWN") {
        if (DEBUG) console.debug(`[UXLens DEBUG] handleEvent top-level catch: ${e.code}`);
      } else {
        console.warn("UXLens handleEvent error:", e.message || e);
      }
    });
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabSessions(tabId);
});
// Test connection helper
globalThis.UXLensTestConnection = async () => {
  const config = await UXLensConfig.readConfig();
  console.log(`[Test Connection] Using backendUrl: ${config.backendUrl}`);
  const origin = "https://example.com";
  try {
    console.log(`[Test Connection] Attempting resolveSite for dummy origin ${origin}...`);
    const siteConfig = await UXLensConfig.resolveSite(origin, config.backendUrl);
    console.log("[Test Connection] resolveSite succeeded:", siteConfig);
  } catch (e) {
    console.log(`[Test Connection] resolveSite expected failure: ${e.code} - ${e.message}`);
  }

  // Create a synthetic event
  const dummyPayload = {
    backendUrl: config.backendUrl,
    ingestionKey: "dummy_key",
    payload: {
      sessionId: "test-session",
      projectId: "test-project",
      type: "click",
      page: "/test",
      timestamp: Date.now(),
      element: { tag: "button", text: "Test Connection Button" },
      metadata: { source: "test" }
    }
  };

  console.log("[Test Connection] Posting dummy click event payload...");
  try {
    const res = await sendToBackend(dummyPayload);
    console.log(`[Test Connection] HTTP Status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.log(`[Test Connection] Response Body: ${text}`);
  } catch (e) {
    console.error("[Test Connection] Failed to post dummy event:", e);
  }
};