(async () => {
  if (window.top !== window) return;
  const log = (stage, data) => globalThis.UXLensLogger && globalThis.UXLensLogger.log("content", stage, data);

  log("script_loaded", { href: location.href, origin: location.origin, top: window.top === window });

  let extensionInvalidated = false;
  let observer = null;
  const ac = new AbortController();
  const { signal } = ac;

  const isContextValid = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };

  const shutdown = (reason) => {
    if (extensionInvalidated) return;
    extensionInvalidated = true;
    ac.abort();
    observer?.disconnect();
    log("shutdown", { reason });
    console.debug("UXLens: extension reloaded, tracking stopped. Refresh the page to resume.");
  };

  const checkConfiguration = () => {
    return new Promise((resolve) => {
      try {
        if (!isContextValid()) {
          shutdown("context_invalid_before_config");
          return resolve(false);
        }
        log("config_request_sent", {});
        chrome.runtime.sendMessage({ type: "configuration-status" }, (response) => {
          if (chrome.runtime.lastError) {
            log("config_request_error", { error: chrome.runtime.lastError.message });
            resolve(false);
            return;
          }
          log("config_response_received", { configured: response?.configured });
          resolve(response?.configured === true);
        });
      } catch (err) {
        log("config_exception", { message: err.message });
        resolve(false);
      }
    }).catch(() => false);
  };

  let isTracking = false;
  
  const initTracking = () => {
    if (isTracking || extensionInvalidated) return;
    isTracking = true;
    log("tracking_started", { message: "Attaching listeners" });

    const emit = (type, target) => {
      if (extensionInvalidated) return;
      if (!isContextValid()) return shutdown("context_invalid_before_emit");
      
      try {
        const tag = target ? (target.tagName || "").toLowerCase() : "";
        const payload = {
          type,
          page: UXLensSanitizer.safePage(),
          timestamp: Date.now(),
          element: UXLensSanitizer.safeElementDetails(target),
          metadata: { source: "extension" }
        };
        
        chrome.runtime.sendMessage({
          type: "uxlens-event",
          event: payload
        }, () => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || "";
            if (msg.includes("The message port closed before a response was received")) return;
            log("emit_error", { type, page: payload.page, tag, error: msg });
            if (msg.includes("Extension context invalidated")) {
              shutdown("context_invalidated_callback");
            }
          } else {
            log("emit_success", { type, page: payload.page, tag });
          }
        });
      } catch (err) {
        const msg = err.message || "";
        log("emit_exception", { type, error: msg });
        if (msg.includes("Extension context invalidated")) {
          shutdown("context_invalidated_exception");
        } else {
          console.error("UXLens emit failed:", err);
        }
      }
    };

    let rawLastUrl = location.pathname + location.search;
    const checkRawUrlChange = () => {
      const currentRawUrl = location.pathname + location.search;
      if (currentRawUrl !== rawLastUrl) {
        rawLastUrl = currentRawUrl;
        emit("navigation", document.body);
      }
    };

    const originalPushState = history.pushState;
    history.pushState = function() {
      originalPushState.apply(this, arguments);
      checkRawUrlChange();
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function() {
      originalReplaceState.apply(this, arguments);
      checkRawUrlChange();
    };
    window.addEventListener("popstate", checkRawUrlChange, { signal });
    window.addEventListener("hashchange", checkRawUrlChange, { signal });

    emit("page_view", document.body);

    document.addEventListener("click", (event) => {
      const target = event.composedPath ? event.composedPath()[0] : event.target;
      emit("click", target);
      if (target instanceof Element && target.closest("a")) {
        const checkInterval = setInterval(checkRawUrlChange, 100);
        setTimeout(() => clearInterval(checkInterval), 1000);
      }
    }, { passive: true, signal, capture: true });

    let lastHoverAt = 0;
    let lastHoverElement = null;
    document.addEventListener("pointerover", (event) => {
      const targetEl = event.composedPath ? event.composedPath()[0] : event.target;
      const target = UXLensSanitizer.findInteractiveElement(targetEl);
      if (!target) {
        // log("hover_ignored", { reason: "no_interactive_element" }); // Omitting to avoid extreme spam
        return;
      }
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) {
        return;
      }
      if (target === lastHoverElement) {
        log("hover_ignored", { reason: "same_element" });
        return;
      }

      const now = Date.now();
      if (now - lastHoverAt < 1000) {
        log("hover_ignored", { reason: "throttle" });
        return;
      }
      
      lastHoverAt = now;
      lastHoverElement = target;
      emit("hover", target);
    }, { passive: true, signal, capture: true });
  };

  const initialConfig = await checkConfiguration();
  if (initialConfig) {
    initTracking();
  } else {
    log("waiting_for_pairing", { message: "Initial config false, waiting for user action" });
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