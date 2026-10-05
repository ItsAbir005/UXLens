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
  return fetch(`${event.backendUrl}/api/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${event.ingestionKey}`
    },
    body: JSON.stringify(event.payload)
  });
}

async function handleEvent(message, sender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number" || !message?.event) return;
  const config = await UXLensConfig.readConfig();
  if (!config.projectId || !config.ingestionKey) return;

  const sessionId = await getSessionId(tabId, config.projectId);
  const currentPage = message.event.page || "/";
  const pageKey = `${sessionStoragePrefix}page:${tabId}:${config.projectId}`;
  const previousPage = (await sessionStorageArea().get(pageKey))[pageKey];
  const basePayload = {
    sessionId,
    projectId: config.projectId,
    type: message.event.type,
    page: currentPage,
    timestamp: Number.isFinite(message.event.timestamp) ? message.event.timestamp : Date.now(),
    element: message.event.element || {},
    metadata: { source: "extension", ...(message.event.metadata || {}) }
  };

  if (message.event.type === "page_view" && previousPage && previousPage !== currentPage) {
    UXLensEventQueue.enqueue({
      ...basePayload,
      type: "navigation",
      element: {},
      metadata: { source: "extension", from: previousPage, to: currentPage }
    }, (payload) => sendToBackend({ backendUrl: config.backendUrl, ingestionKey: config.ingestionKey, payload }));
  }

  await sessionStorageArea().set({ [pageKey]: currentPage });
  UXLensEventQueue.enqueue(basePayload, (payload) => sendToBackend({ backendUrl: config.backendUrl, ingestionKey: config.ingestionKey, payload }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "configuration-status") {
    UXLensConfig.readConfig()
      .then(({ projectId, ingestionKey }) => sendResponse({ configured: Boolean(projectId && ingestionKey) }))
      .catch(() => sendResponse({ configured: false }));
    return true;
  }
  if (message?.type === "uxlens-event") void handleEvent(message, sender);
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabSessions(tabId);
});