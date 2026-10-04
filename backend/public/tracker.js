(() => {
  if (window.__uxlensTrackerLoaded) return;
  window.__uxlensTrackerLoaded = true;

  const script = document.currentScript;
  const scriptUrl = script ? new URL(script.src) : null;
  const endpoint = scriptUrl ? `${scriptUrl.origin}/api/events` : "/api/events";
  const projectId = script?.dataset.projectId || scriptUrl?.searchParams.get("projectId") || undefined;
  const previousUrlKey = "uxlens-last-url";
  const sessionStorageKey = "uxlens-session-id";
  const sessionId = sessionStorage.getItem(sessionStorageKey) || crypto.randomUUID();
  sessionStorage.setItem(sessionStorageKey, sessionId);

  const page = () => `${window.location.pathname}${window.location.search}`;
  const send = (type, details = {}, metadata = {}) => {
    const event = {
      sessionId,
      type,
      page: page(),
      timestamp: Date.now(),
      element: details,
      metadata: { ...metadata, origin: window.location.origin, ...(projectId ? { projectId } : {}) },
      ...(projectId ? { projectId } : {})
    };
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true
    }).catch(() => {});
  };
  const elementDetails = (target) => ({
    tag: target?.tagName?.toLowerCase(),
    id: target?.id || undefined,
    text: target?.textContent?.trim().slice(0, 200) || undefined,
    role: target?.getAttribute?.("role") || implicitRole(target)
  });

  function implicitRole(target) {
    const tag = target?.tagName?.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "textarea" || tag === "select") return "textbox";
    if (tag === "input") return target.type === "submit" || target.type === "button" ? "button" : "textbox";
    return undefined;
  }

  const previousUrl = sessionStorage.getItem(previousUrlKey);
  if (previousUrl && previousUrl !== window.location.href) {
    send("navigation", {}, { from: previousUrl, to: window.location.href });
  }
  sessionStorage.setItem(previousUrlKey, window.location.href);
  let currentUrl = window.location.href;
  const repeatedClickWindowMs = 2000;
  const repeatedClickThreshold = 3;
  const highVolumeEventIntervalMs = 100;
  const repeatedClicks = new WeakMap();
  const hoverStarts = new WeakMap();
  let lastHoverAt = -Infinity;
  let scrollTimer;
  let pendingScrollEvent;
  const diagnosticsEnabled = scriptUrl?.hostname === "localhost" || scriptUrl?.hostname === "127.0.0.1";
  const trackedElement = (target) => target instanceof Element
    ? target.closest("button, a, input, textarea, select, [role]") || target
    : target instanceof Node ? target.parentElement : null;
  const elementDebugDetails = (target) => ({
    tag: target?.tagName?.toLowerCase(),
    id: target?.id || ""
  });
  const debug = (label, details) => {
    if (diagnosticsEnabled) console.debug(`[UXLens ${label}]`, details);
  };
  const emitHover = (target, duration, endedBy) => {
    const now = performance.now();
    if (now - lastHoverAt < highVolumeEventIntervalMs) return;
    lastHoverAt = now;
    send("hover", elementDetails(target), {
      duration: Math.round(duration),
      ...(endedBy ? { endedBy } : {})
    });
  };
  send("page_view", {}, { url: window.location.href });
  document.addEventListener("click", (event) => {
    const target = trackedElement(event.target);
    const details = elementDetails(target);
    const hoverStartedAt = target instanceof Element ? hoverStarts.get(target) : undefined;
    const timerFound = hoverStartedAt !== undefined;
    const clickReadAt = performance.now();
    debug("click", {
      action: "click-check",
      eventType: event.type,
      performanceNow: clickReadAt,
      timerFound,
      elapsedSinceStart: timerFound
        ? Math.round(clickReadAt - hoverStartedAt)
        : undefined
    });
    const elapsedSinceStart = timerFound
      ? Math.max(0, clickReadAt - hoverStartedAt)
      : undefined;
    debug("click", {
      normalizedElement: elementDebugDetails(target),
      eventTarget: elementDebugDetails(event.target),
      timerFound,
      duration: elapsedSinceStart === undefined ? undefined : Math.round(elapsedSinceStart)
    });
    if (target instanceof Element && elapsedSinceStart !== undefined) {
      const hoverDuration = Math.round(elapsedSinceStart);
      emitHover(target, hoverDuration, "click");
      send("click", details, {
        x: event.clientX,
        y: event.clientY,
        url: window.location.href,
        hoverDuration,
        hoverToClickDuration: hoverDuration
      });
    } else {
      send("click", details, {
        x: event.clientX,
        y: event.clientY,
        url: window.location.href
      });
    }
    if (target instanceof Element) hoverStarts.delete(target);

    if (!(target instanceof Element)) return;
    const now = Date.now();
    const previous = repeatedClicks.get(target);
    const state = previous && now - previous.startedAt <= repeatedClickWindowMs
      ? { ...previous, count: previous.count + 1 }
      : { count: 1, startedAt: now, reported: false };
    repeatedClicks.set(target, state);

    if (state.count >= repeatedClickThreshold && !state.reported) {
      state.reported = true;
      send("repeated_click", details, {
        count: state.count,
        windowMs: repeatedClickWindowMs,
        message: `Repeated clicking detected on ${details.text || details.role || details.tag || "element"}`
      });
    }
  }, { passive: true });
  document.addEventListener("pointerover", (event) => {
    const target = trackedElement(event.target);
    if (!(target instanceof Element)) return;
    const performanceNow = performance.now();
    const timerFound = hoverStarts.has(target);
    debug("hover", {
      action: timerFound ? "already-running" : "start",
      eventType: event.type,
      eventTarget: elementDebugDetails(event.target),
      normalizedElement: elementDebugDetails(target),
      relatedTarget: elementDebugDetails(event.relatedTarget),
      timerFound,
      performanceNow
    });
    if (timerFound) {
      return;
    }
    hoverStarts.set(target, performanceNow);
  }, { passive: true });
  if (diagnosticsEnabled) {
    let observedContinue = document.querySelector("#continue");
    debug("diagnostic", {
      action: "continue-node-initial",
      node: elementDebugDetails(observedContinue),
      performanceNow: performance.now()
    });

    new MutationObserver(() => {
      const currentContinue = document.querySelector("#continue");
      if (currentContinue === observedContinue) return;
      debug("diagnostic", {
        action: "continue-node-changed",
        previousNode: elementDebugDetails(observedContinue),
        currentNode: elementDebugDetails(currentContinue),
        performanceNow: performance.now()
      });
      observedContinue = currentContinue;
    }).observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener("pointermove", (event) => {
      const continueElement = document.querySelector("#continue");
      const target = trackedElement(event.target);
      if (!continueElement || (target !== continueElement && !continueElement.contains(target))) return;
      debug("diagnostic", {
        action: "pointermove-over-continue",
        eventTarget: elementDebugDetails(event.target),
        normalizedElement: elementDebugDetails(target),
        performanceNow: performance.now()
      });
    }, { passive: true });
  }
  document.addEventListener("scroll", () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    pendingScrollEvent = scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 100;
    if (scrollTimer) return;
    scrollTimer = window.setTimeout(() => {
      send("scroll", {}, { percentage: pendingScrollEvent });
      scrollTimer = undefined;
      pendingScrollEvent = undefined;
    }, highVolumeEventIntervalMs);
  }, { passive: true });

  const trackNavigation = (from) => {
    send("navigation", {}, { from, to: window.location.href });
    currentUrl = window.location.href;
  };
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const from = window.location.href;
      const result = original.apply(this, args);
      if (from !== window.location.href) trackNavigation(from);
      return result;
    };
  }
  window.addEventListener("popstate", () => trackNavigation(currentUrl));
})();