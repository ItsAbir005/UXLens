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

  emit("page_view", document.body);

  document.addEventListener("click", (event) => {
    emit("click", event.target);
  }, { passive: true });

  let lastHoverAt = 0;
  document.addEventListener("pointerover", (event) => {
    const target = UXLensSanitizer.findInteractiveElement(event.target);
    if (!target || event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    const now = Date.now();
    if (now - lastHoverAt < 250) return;
    lastHoverAt = now;
    emit("hover", target);
  }, { passive: true });
})();