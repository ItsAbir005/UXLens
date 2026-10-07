(async () => {
  if (window.top !== window) return;

  const configuration = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "configuration-status" }, (response) => {
      resolve(response?.configured === true);
    });
  }).catch(() => false);
  if (!configuration) return;

  const emit = (type, target) => {
    chrome.runtime.sendMessage({
      type: "uxlens-event",
      event: {
        type,
        page: UXLensSanitizer.safePage(),
        timestamp: Date.now(),
        element: UXLensSanitizer.safeElementDetails(target),
        metadata: { source: "extension" }
      }
    });
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
    });
  } else {
    window.addEventListener("popstate", checkUrlChange);
    new MutationObserver(checkUrlChange).observe(document, { subtree: true, childList: true });
  }

  emit("page_view", document.body);

  document.addEventListener("click", (event) => {
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    emit("click", target);
  }, { passive: true });

  let lastHoverAt = 0;
  document.addEventListener("pointerover", (event) => {
    const targetEl = event.composedPath ? event.composedPath()[0] : event.target;
    const target = UXLensSanitizer.findInteractiveElement(targetEl);
    if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
    const now = Date.now();
    if (now - lastHoverAt < 250) return;
    lastHoverAt = now;
    emit("hover", target);
  }, { passive: true });
})();