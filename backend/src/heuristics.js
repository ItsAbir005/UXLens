const HEURISTICS_TABLE = {
  dead_click: {
    id: 1,
    name: "Visibility of system status",
    rationale: "The click gave no visible feedback",
    suggestion: "Add an immediate pressed/loading state or make clear the element is not interactive"
  },
  repeated_click: {
    id: 1,
    name: "Visibility of system status",
    rationale: "The user is unsure the action registered",
    suggestion: "Show immediate feedback such as a spinner or a disabled state"
  },
  repeated_clicks: {
    id: 1,
    name: "Visibility of system status",
    rationale: "The user is unsure the action registered",
    suggestion: "Show immediate feedback such as a spinner or a disabled state"
  },
  hesitation: {
    id: 6,
    name: "Recognition rather than recall",
    rationale: "The user paused before acting",
    suggestion: "Use a plain-language label and add a tooltip"
  },
  backtracking: {
    id: 3,
    name: "User control and freedom",
    rationale: "The user retraced their path",
    suggestion: "Add clear back/breadcrumb navigation and a simpler menu structure"
  }
};

export const mapProblemToHeuristic = (problem) => {
  const type = problem?.type;
  const entry = HEURISTICS_TABLE[type] || {
    id: 1,
    name: "Visibility of system status",
    rationale: "The interface state is unclear",
    suggestion: "Provide clear feedback and cues for system state"
  };

  const occurrences = typeof problem?.occurrences === "number" ? problem.occurrences : 0;
  let confidence = "low";
  if (occurrences >= 6) {
    confidence = "high";
  } else if (occurrences >= 3) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    id: entry.id,
    name: entry.name,
    rationale: entry.rationale,
    suggestion: entry.suggestion,
    confidence
  };
};
