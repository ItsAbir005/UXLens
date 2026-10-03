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
    tag: target.tagName?.toLowerCase(),
    id: target.id || undefined,
    text: target.textContent?.trim().slice(0, 200) || undefined,
    role: target.getAttribute?.("role") || implicitRole(target)
  });

  function implicitRole(target) {
    const tag = target.tagName?.toLowerCase();
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
  send("page_view", {}, { url: window.location.href });
  document.addEventListener("click", (event) => {
    send("click", elementDetails(event.target), { x: event.clientX, y: event.clientY, url: window.location.href });
  }, { passive: true });
  document.addEventListener("mouseover", (event) => {
    if (event.target instanceof Element && event.relatedTarget instanceof Element && event.target.contains(event.relatedTarget)) return;
    send("hover", elementDetails(event.target));
  }, { passive: true });
  document.addEventListener("scroll", () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    send("scroll", {}, { percentage: scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 100 });
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