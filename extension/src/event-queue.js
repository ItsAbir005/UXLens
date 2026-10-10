(() => {
  const log = (stage, data) => globalThis.UXLensLogger && globalThis.UXLensLogger.log("background", stage, data);
  const storageArea = chrome.storage.local;
  const maxRetries = 3;
  const retryDelayMs = 5000;
  
  let processing = false;
  let sendEventFn = null;

  let chain = Promise.resolve();
  const withLock = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  const getQueue = async () => {
    try {
      const data = await storageArea.get("uxlens_event_queue");
      return Array.isArray(data.uxlens_event_queue) ? data.uxlens_event_queue : [];
    } catch {
      return [];
    }
  };

  const saveQueue = async (queue) => {
    await storageArea.set({ uxlens_event_queue: queue });
  };

  const fingerprint = (event) => JSON.stringify([
    event.payload.sessionId,
    event.payload.type,
    event.payload.page,
    event.payload.timestamp,
    event.payload.element
  ]);

  const enqueue = async (event) => {
    await withLock(async () => {
      const q = await getQueue();
      const fp = fingerprint(event);
      if (q.some((i) => i.fingerprint === fp)) {
        log("enqueue_skipped", { reason: "duplicate_fingerprint", type: event.payload.type });
        return;
      }
      
      q.push({ event, fingerprint: fp, retries: 0 });
      if (q.length > 500) q.shift();
      await saveQueue(q);
      log("enqueue_added", { type: event.payload.type, newQueueLength: q.length });
    });
    void processQueue();
  };

  const processQueue = async () => {
    if (processing || !sendEventFn) return;
    processing = true;

    try {
      while (true) {
        const item = await withLock(async () => {
          const q = await getQueue();
          return q.length > 0 ? q[0] : null;
        });

        if (!item) break;

        let response = null;
        let fetchError = null;

        try {
          response = await sendEventFn(item.event);
          log("queue_processing", { type: item.event.payload.type, url: item.event.backendUrl, status: response.status, retries: item.retries });
          
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            log("queue_processing_error_body", { type: item.event.payload.type, status: response.status, body: text });
          }
        } catch (err) {
          fetchError = err;
          log("queue_fetch_exception", { error: err.message, type: item.event.payload.type });
        }

        const shouldStop = await withLock(async () => {
          const q = await getQueue();
          const idx = q.findIndex(i => i.fingerprint === item.fingerprint);
          if (idx === -1) return false;
          
          const currentItem = q[idx];
          let stopProcessing = false;

          if (fetchError) {
            currentItem.retries++;
            if (currentItem.retries > maxRetries) {
              log("queue_dropped", { reason: "max_retries_exceeded_network", type: currentItem.event.payload.type });
              q.splice(idx, 1);
            }
            chrome.alarms.create("uxlens_retry", { delayInMinutes: 1 });
            stopProcessing = true;
          } else {
            if (response.ok) {
              q.splice(idx, 1);
            } else if (response.status === 401 || response.status === 403) {
              log("queue_dropped", { reason: "STALE OR WRONG INGESTION KEY", status: response.status, type: currentItem.event.payload.type });
              try {
                const originUrl = new URL(currentItem.event.payload.page);
                const origin = originUrl.origin;
                await storageArea.remove(`site_${origin}`);
                log("queue_cleared_site_cache", { origin });
              } catch (e) {}
              q.splice(idx, 1);
            } else if (response.status === 429) {
              log("queue_rate_limited", { type: currentItem.event.payload.type });
              currentItem.retries++;
              chrome.alarms.create("uxlens_retry", { delayInMinutes: 1 });
              stopProcessing = true;
            } else if (response.status >= 500) {
              currentItem.retries++;
              if (currentItem.retries > maxRetries) {
                log("queue_dropped", { reason: "max_retries_exceeded_5xx", type: currentItem.event.payload.type });
                q.splice(idx, 1);
              }
              chrome.alarms.create("uxlens_retry", { delayInMinutes: 1 });
              stopProcessing = true;
            } else {
              log("queue_dropped", { reason: `client_error_${response.status}`, type: currentItem.event.payload.type });
              q.splice(idx, 1);
            }
          }

          await saveQueue(q);
          return stopProcessing;
        });

        if (shouldStop) break;
      }
    } finally {
      processing = false;
    }
  };

  const setHandler = (fn) => {
    sendEventFn = fn;
    void processQueue();
  };

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "uxlens_retry") {
      log("alarm_triggered", { name: alarm.name });
      void processQueue();
    }
  });

  globalThis.UXLensEventQueue = { enqueue, setHandler, processQueue };
})();