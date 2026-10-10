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

  const safePage = () => {
    const path = window.location.pathname || "/";
    return path.split('/').map(segment => {
      if (!segment) return segment;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":id";
      if (/^[0-9a-f]{8,}$/i.test(segment)) return ":id";
      if (/^\d{4,}$/.test(segment)) return ":id";
      if (segment.length >= 20 && /\d/.test(segment)) return ":id";
      return segment;
    }).join('/');
  };

  const safeElementDetails = (target) => {
    const element = findInteractiveElement(target) || (target instanceof Element ? target : null);
    if (!element) return {};

    const details = {};
    const tag = element.tagName?.toLowerCase();
    const id = boundedSafeString(element.id);
    
    if (tag) details.tag = tag;
    if (id) details.id = id;

    if (tag === "a") {
      return details;
    }

    const role = boundedSafeString(element.getAttribute("role"));
    const ariaLabel = boundedSafeString(element.getAttribute("aria-label"));
    const isLabelSafe = ["button"].includes(tag) || Boolean(role);
    const visibleLabel = isLabelSafe ? boundedSafeString(element.innerText) : undefined;

    if (role) details.role = role;
    if (ariaLabel) details.label = ariaLabel;
    else if (visibleLabel) details.label = visibleLabel;
    return details;
  };

  globalThis.UXLensSanitizer = { findInteractiveElement, safeElementDetails, safePage };
})();