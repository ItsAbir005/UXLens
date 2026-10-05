(() => {
  const maxQueueSize = 50;
  const maxRetries = 3;
  const retryDelayMs = 2000;
  const queue = [];
  const fingerprints = new Set();
  let processing = false;

  const fingerprint = (event) => JSON.stringify([
    event.sessionId,
    event.type,
    event.page,
    event.timestamp,
    event.element
  ]);

  const processQueue = async (sendEvent) => {
    if (processing) return;
    processing = true;
    try {
      while (queue.length) {
        const item = queue[0];
        try {
          const response = await sendEvent(item.event);
          if (response.ok || response.status >= 400 && response.status < 500) {
            queue.shift();
            fingerprints.delete(item.fingerprint);
            continue;
          }
          throw new Error(`Temporary backend response: ${response.status}`);
        } catch {
          item.retries += 1;
          if (item.retries > maxRetries) {
            queue.shift();
            fingerprints.delete(item.fingerprint);
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * item.retries));
          break;
        }
      }
    } finally {
      processing = false;
    }
  };

  const enqueue = (event, sendEvent) => {
    const eventFingerprint = fingerprint(event);
    if (fingerprints.has(eventFingerprint)) return;
    if (queue.length >= maxQueueSize) queue.shift();
    queue.push({ event, fingerprint: eventFingerprint, retries: 0 });
    fingerprints.add(eventFingerprint);
    void processQueue(sendEvent);
  };

  globalThis.UXLensEventQueue = { enqueue };
})();