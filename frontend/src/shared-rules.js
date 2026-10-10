export const isDeadClick = (event, sessionEvents) => {
  if (event.element?.responded !== false) return false;
  const eventTime = new Date(event.timestamp).getTime();
  return !sessionEvents.some(cand => 
    (cand.type === "navigation" || cand.type === "page_view") &&
    new Date(cand.timestamp).getTime() > eventTime &&
    new Date(cand.timestamp).getTime() - eventTime <= 5000
  );
};