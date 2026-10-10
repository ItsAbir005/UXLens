const fs = require('fs');
let code = fs.readFileSync('extension/src/content.js', 'utf8');

const getSessionIdFn = 
  const getSessionId = () => {
    try {
      let id = window.sessionStorage.getItem("uxlens_session_id");
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        window.sessionStorage.setItem("uxlens_session_id", id);
      }
      return id;
    } catch {
      if (!globalThis.uxlens_mem_session_id) {
        globalThis.uxlens_mem_session_id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      }
      return globalThis.uxlens_mem_session_id;
    }
  };
;

code = code.replace('let isTracking = false;', getSessionIdFn + '\n  let isTracking = false;');

const emitTarget =     const emit = (type, target) => {;
const emitReplace =     const emit = (type, target, extraDetails = {}) => {;
code = code.replace(emitTarget, emitReplace);

const elementTarget = element: UXLensSanitizer.safeElementDetails(target),;
const elementReplace = element: UXLensSanitizer.safeElementDetails(target, extraDetails),;
code = code.replace(elementTarget, elementReplace);

const metaTarget = metadata: { source: "extension" };
const metaReplace = metadata: { source: "extension", sessionId: getSessionId() };
code = code.replace(metaTarget, metaReplace);

const clickTarget =     document.addEventListener("click", (event) => {
      const target = event.composedPath ? event.composedPath()[0] : event.target;
      emit("click", target);
      if (target instanceof Element && target.closest("a")) {
        const checkInterval = setInterval(checkRawUrlChange, 100);
        setTimeout(() => clearInterval(checkInterval), 1000);
      }
    }, { passive: true, signal, capture: true });;

const clickReplace =     document.addEventListener("click", (event) => {
      const targetEl = event.composedPath ? event.composedPath()[0] : event.target;
      const target = UXLensSanitizer.findInteractiveElement(targetEl) || targetEl;
      const tag = (target.tagName || "").toLowerCase();
      const role = target.getAttribute ? target.getAttribute("role") : null;
      const isTracked = tag === "button" || tag === "a" || role === "button";
      
      if (!isTracked) {
        emit("click", targetEl);
        return;
      }

      let responded = false;
      const initialUrl = location.pathname + location.search + location.hash;
      
      const clickObserver = new MutationObserver(() => {
        responded = true;
      });
      clickObserver.observe(document.body, { childList: true, attributes: true, subtree: true });

      const checkUrl = () => {
        if (location.pathname + location.search + location.hash !== initialUrl) responded = true;
      };
      const urlInterval = setInterval(checkUrl, 100);

      setTimeout(() => {
        clickObserver.disconnect();
        clearInterval(urlInterval);
        checkUrl();
        emit("click", target, { responded });
      }, 1000);

      if (tag === "a") {
        const checkAnchorInterval = setInterval(checkRawUrlChange, 100);
        setTimeout(() => clearInterval(checkAnchorInterval), 1000);
      }
    }, { passive: true, signal, capture: true });;
    
code = code.replace(clickTarget, clickReplace);
fs.writeFileSync('extension/src/content.js', code);

let sanCode = fs.readFileSync('extension/src/event-sanitizer.js', 'utf8');
sanCode = sanCode.replace('const safeElementDetails = (target) => {', 'const safeElementDetails = (target, extra = {}) => {');
sanCode = sanCode.replace('return details;', 'if (typeof extra.responded === "boolean") details.responded = extra.responded;\n    return details;');
fs.writeFileSync('extension/src/event-sanitizer.js', sanCode);