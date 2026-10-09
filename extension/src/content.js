(async () => {
  if (window.top !== window) return;

  let extensionInvalidated = false;
  let observer = null;
  const ac = new AbortController();
  const { signal } = ac;

  const isContextValid = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };

  const shutdown = () => {
    if (extensionInvalidated) return;
    extensionInvalidated = true;
    ac.abort();
    observer?.disconnect();
    console.debug("UXLens: extension reloaded, tracking stopped. Refresh the page to resume.");
  };

  const checkConfiguration = () => {
    return new Promise((resolve) => {
      try {
        if (!isContextValid()) {
          shutdown();
          return resolve(false);
        }
        chrome.runtime.sendMessage({ type: "configuration-status" }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(response?.configured === true);
        });
      } catch (err) {
        resolve(false);
      }
    }).catch(() => false);
  };

  let isTracking = false;
  
  const initTracking = () => {
    if (isTracking || extensionInvalidated) return;
    isTracking = true;

    const emit = (type, target) => {
      if (extensionInvalidated) return;
      if (!isContextValid()) return shutdown();
      
      try {
        chrome.runtime.sendMessage({
          type: "uxlens-event",
          event: {
            type,
            page: UXLensSanitizer.safePage(),
            timestamp: Date.now(),
            element: UXLensSanitizer.safeElementDetails(target),
            metadata: { source: "extension" }
          }
        }, () => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || "";
            if (msg.includes("Extension context invalidated")) {
              shutdown();
            }
          }
        });
      } catch (err) {
        if (err.message && err.message.includes("Extension context invalidated")) {
          shutdown();
        } else {
          console.error("UXLens emit failed:", err);
        }
      }
    };

    let lastPath = UXLensSanitizer.safePage();
    const checkUrlChange = () => {
      const currentPath = UXLensSanitizer.safePage();
      if (currentPath !== lastPath) {
        lastPath = currentPath;
        emit("page_view", document.body);
      }
    };

    if (window.navigation) {
      window.navigation.addEventListener("navigate", (e) => {
        // Small delay to let the URL actually change in the browser before reading it
        setTimeout(checkUrlChange, 0);
      }, { signal });
    } else {
      window.addEventListener("popstate", checkUrlChange, { signal });
      observer = new MutationObserver(checkUrlChange);
      observer.observe(document, { subtree: true, childList: true });
    }

    emit("page_view", document.body);

    document.addEventListener("click", (event) => {
      const target = event.composedPath ? event.composedPath()[0] : event.target;
      emit("click", target);
    }, { passive: true, signal, capture: true });

    let lastHoverAt = 0;
    let lastHoverElement = null;
    document.addEventListener("pointerover", (event) => {
      const targetEl = event.composedPath ? event.composedPath()[0] : event.target;
      const target = UXLensSanitizer.findInteractiveElement(targetEl);
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
      if (target === lastHoverElement) return;

      const now = Date.now();
      if (now - lastHoverAt < 1000) return;
      
      lastHoverAt = now;
      lastHoverElement = target;
      emit("hover", target);
    }, { passive: true, signal, capture: true });
  };

  const initialConfig = await checkConfiguration();
  if (initialConfig) {
    initTracking();
  } else {
    let lastCheck = 0;
    const tryReconfigure = async () => {
      if (isTracking || extensionInvalidated) return;
      const now = Date.now();
      if (now - lastCheck < 10000) return;
      lastCheck = now;
      
      const configured = await checkConfiguration();
      if (configured) initTracking();
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tryReconfigure();
    }, { signal });
    document.addEventListener("click", tryReconfigure, { passive: true, signal, capture: true });
    document.addEventListener("pointerover", tryReconfigure, { passive: true, signal, capture: true });
  }
})();