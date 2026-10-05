(() => {
  const sensitivePattern = /(password|passwd|secret|token|auth|credential|email|phone|address|card|ssn|social|security|api.?key)/i;
  const interactiveSelector = "button, a, input, textarea, select, [role], [contenteditable=\"true\"]";
  const maxLabelLength = 80;

  const boundedSafeString = (value) => {
    if (typeof value !== "string") return undefined;
    const clean = value.replace(/\s+/g, " ").trim().slice(0, maxLabelLength);
    if (!clean || sensitivePattern.test(clean)) return undefined;
    return clean;
  };

  const findInteractiveElement = (target) => {
    if (!(target instanceof Element)) return null;
    return target.closest(interactiveSelector) || null;
  };

  const safePage = () => window.location.pathname || "/";

  const safeElementDetails = (target) => {
    const element = findInteractiveElement(target) || (target instanceof Element ? target : null);
    if (!element) return {};

    const details = {};
    const tag = element.tagName?.toLowerCase();
    const id = boundedSafeString(element.id);
    const role = boundedSafeString(element.getAttribute("role"));
    const ariaLabel = boundedSafeString(element.getAttribute("aria-label"));
    const isLabelSafe = ["button", "a"].includes(tag) || Boolean(role);
    const visibleLabel = isLabelSafe ? boundedSafeString(element.innerText) : undefined;

    if (tag) details.tag = tag;
    if (id) details.id = id;
    if (role) details.role = role;
    if (ariaLabel) details.label = ariaLabel;
    else if (visibleLabel) details.label = visibleLabel;
    return details;
  };

  globalThis.UXLensSanitizer = { findInteractiveElement, safeElementDetails, safePage };
})();