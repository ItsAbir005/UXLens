(() => {
  const log = (stage, data) => globalThis.UXLensLogger && globalThis.UXLensLogger.log("background", stage, data);
  const storageArea = chrome.storage.local;
  const maxRetries = 3;
  const retryDelayMs = 5000;
  
  let processing = false;
  let sendEventFn = null;

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
    const q = await getQueue();
    const fp = fingerprint(event);
    if (q.some((i) => i.fingerprint === fp)) {
      log("enqueue_skipped", { reason: "duplicate_fingerprint", type: event.payload.type });
      return;
    }
    
    q.push({ event, fingerprint: fp, retries: 0 });
    await saveQueue(q);
    log("enqueue_added", { type: event.payload.type, newQueueLength: q.length });
    
    void processQueue();
  };

  const processQueue = async () => {
    if (processing || !sendEventFn) return;
    processing = true;

    try {
      let q = await getQueue();
      while (q.length > 0) {
        const item = q[0];
        try {
          const response = await sendEventFn(item.event);
          log("queue_processing", { type: item.event.payload.type, url: item.event.backendUrl, status: response.status, retries: item.retries });
          
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            log("queue_processing_error_body", { type: item.event.payload.type, status: response.status, body: text });
            
            if (response.status === 401 || response.status === 403) {
              log("queue_dropped", { reason: "STALE OR WRONG INGESTION KEY", status: response.status, type: item.event.payload.type });
              
              // Clear cache for this origin
              try {
                const originUrl = new URL(item.event.payload.page);
                const origin = originUrl.origin;
                await storageArea.remove(`site_${origin}`);
                log("queue_cleared_site_cache", { origin });
              } catch (e) {}
              
              q.shift();
              await saveQueue(q);
              continue;
            } else if (response.status === 429) {
              log("queue_rate_limited", { type: item.event.payload.type });
              item.retries++;
              await saveQueue(q);
              chrome.alarms.create("uxlens_retry", { delayInMinutes: 1 });
              break; // Stop processing and wait for alarm
            } else if (response.status >= 500) {
              item.retries++;
              if (item.retries > maxRetries) {
                log("queue_dropped", { reason: "max_retries_exceeded_5xx", type: item.event.payload.type });
                q.shift();
              }
              await saveQueue(q);
              chrome.alarms.create("uxlens_retry", { delayInMinutes: 1 });
              break;
            } else {
              // 400 or other 4xx
              log("queue_dropped", { reason: `client_error_${response.status}`, type: item.event.payload.type });
              q.shift();
              await saveQueue(q);
              continue;
            }
          }
          
          // Success
          q.shift();
          await saveQueue(q);
        } catch (err) {
          log("queue_fetch_exception", { error: err.message, type: item.event.payload.type });
          item.retries++;
          if (item.retries > maxRetries) {
            log("queue_dropped", { reason: "max_retries_exceeded_network", type: item.event.payload.type });
            q.shift();
          }
          await saveQueue(q);
          chrome.alarms.create("uxlens_retry", { delayInMinutes: 1 });
          break;
        }
        
        // Refresh queue representation in case multiple tabs enqueued concurrently
        q = await getQueue();
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