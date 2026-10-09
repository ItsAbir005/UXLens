(() => {
  const maxQueueSize = 50;
  const maxRetries = 3;
  const retryDelayMs = 2000;

  const storageArea = chrome.storage.local;
  let processing = false;
  let sendEventFn = null;

  const fingerprint = (event) => JSON.stringify([
    event.payload.sessionId,
    event.payload.type,
    event.payload.page,
    event.payload.timestamp,
    event.payload.element
  ]);

  const getQueue = async () => {
    try {
      const data = await storageArea.get("uxlens_event_queue");
      return Array.isArray(data.uxlens_event_queue) ? data.uxlens_event_queue : [];
    } catch {
      return [];
    }
  };

  const saveQueue = async (q) => {
    try {
      await storageArea.set({ uxlens_event_queue: q.slice(-maxQueueSize) });
    } catch {}
  };

  const processQueue = async () => {
    if (processing || !sendEventFn) return;
    processing = true;
    try {
      let q = await getQueue();
      let changed = false;

      while (q.length > 0) {
        const item = q[0];
        try {
          const response = await sendEventFn(item.event);
          // Drop on success or 4xx, BUT do not drop on 429 Too Many Requests
          if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
            q.shift();
            changed = true;
            continue;
          }
          throw new Error(`Backend response: ${response.status}`);
        } catch (err) {
          item.retries = (item.retries || 0) + 1;
          changed = true;
          if (item.retries > maxRetries) {
            q.shift();
            continue;
          }
          try { chrome.alarms.create("uxlens_retry", { when: Date.now() + retryDelayMs * item.retries }); } catch {}
          break;
        }
      }
      if (changed) {
        await saveQueue(q);
      }
    } finally {
      processing = false;
    }
  };

  const enqueue = async (event) => {
    const fp = fingerprint(event);
    let q = await getQueue();
    
    if (q.some(item => item.fingerprint === fp)) {
      if (sendEventFn) void processQueue();
      return;
    }

    if (q.length >= maxQueueSize) q.shift();
    q.push({ event, fingerprint: fp, retries: 0 });
    await saveQueue(q);

    if (sendEventFn) void processQueue();
  };

  const setHandler = (fn) => {
    sendEventFn = fn;
    void processQueue();
  };

  try {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "uxlens_retry") {
        void processQueue();
      }
    });
  } catch {}

  globalThis.UXLensEventQueue = { enqueue, setHandler, processQueue };
})();