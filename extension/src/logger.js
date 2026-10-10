const UXLensLogger = {
  log: async (where, stage, data) => {
    // Redact full ingestion keys recursively
    const sanitize = (obj) => {
      if (typeof obj !== 'object' || obj === null) return obj;
      let copy = Array.isArray(obj) ? [...obj] : { ...obj };
      for (const key in copy) {
        if (key === 'ingestionKey' && typeof copy[key] === 'string') {
          copy[key] = copy[key].substring(0, 6) + '...';
        } else if (typeof copy[key] === 'object') {
          copy[key] = sanitize(copy[key]);
        }
      }
      return copy;
    };
    
    const sanitizedData = sanitize(data);
    const timestamp = new Date().toISOString();
    console.log(`[UXLens][${where}][${stage}]`, timestamp, sanitizedData);
    
    try {
      const res = await chrome.storage.local.get("uxlens_debug_log");
      let logs = res.uxlens_debug_log || [];
      logs.push({ timestamp, where, stage, data: sanitizedData });
      if (logs.length > 200) logs = logs.slice(-200);
      await chrome.storage.local.set({ uxlens_debug_log: logs });
    } catch (e) {
      console.warn("UXLensLogger error saving to storage", e);
    }
  }
};
globalThis.UXLensLogger = UXLensLogger;