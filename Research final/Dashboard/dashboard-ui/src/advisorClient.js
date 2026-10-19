// advisorClient.js — Decision Advisor API clients
// ------------------------------------------------
// Thin fetch wrappers over the advisor endpoints exposed by the gateway and
// proxied to Component 4 (FastAPI):
//   POST /api/advisor/decide        -> cost-sensitive top-3 decision
//   GET  /api/advisor/brief/:svc    -> plain-language operator brief
//   POST /api/advisor/feedback      -> append-only accept/ignore/override log
//   GET  /api/advisor/drift         -> per-service drift + retrain advice
//   GET/POST /api/advisor/thresholds-> threshold suggestions (human-approved)
//
// These never invent a result: when Component 4 is offline the gateway returns
// HTTP 503 and the caller surfaces an "advisor unavailable" state.

async function _json(res) {
  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok) {
    const err = new Error(body.error || body.detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function advisorDecide({ serviceName, comp2Cpu, memProb = 0 }) {
  const res = await fetch("/api/advisor/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_name: serviceName,
      comp2_cpu: comp2Cpu,
      mem_prob: memProb,
    }),
    cache: "no-store",
  });
  return _json(res);
}

export async function advisorBrief(serviceName) {
  const res = await fetch(
    `/api/advisor/brief/${encodeURIComponent(serviceName)}`,
    { cache: "no-store" }
  );
  return _json(res);
}

export async function advisorFeedback({
  serviceName,
  decision,
  recommendedAction,
  chosenAction = null,
  confidence = null,
  outcome = null,
}) {
  const res = await fetch("/api/advisor/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_name: serviceName,
      decision,
      recommended_action: recommendedAction,
      chosen_action: chosenAction,
      confidence,
      outcome,
    }),
  });
  return _json(res);
}

export async function advisorDrift() {
  const res = await fetch("/api/advisor/drift", { cache: "no-store" });
  return _json(res);
}

export async function advisorThresholds() {
  const res = await fetch("/api/advisor/thresholds", { cache: "no-store" });
  return _json(res);
}

export async function advisorThresholdSuggest({ serviceName, cpuProb, memProb }) {
  const res = await fetch("/api/advisor/thresholds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_name: serviceName,
      cpu_prob: cpuProb,
      mem_prob: memProb,
    }),
  });
  return _json(res);
}

// ── Ask Sentinel Chat ──────────────────────────────────────────────────────
export async function advisorChat({ message, service = "", sessionId = "default" }) {
  const res = await fetch("/api/advisor/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, service, session_id: sessionId }),
  });
  return _json(res);
}

export async function advisorChatSuggestions() {
  const res = await fetch("/api/advisor/chat/suggestions", { cache: "no-store" });
  return _json(res);
}

// ── Per-service Explainability & Mitigation (Phase 1 — READ-ONLY GETs) ────
export async function serviceExplanation(serviceName) {
  const res = await fetch(
    `/api/services/${encodeURIComponent(serviceName)}/explanation`,
    { cache: "no-store" }
  );
  return _json(res);
}

export async function serviceMitigation(serviceName) {
  const res = await fetch(
    `/api/services/${encodeURIComponent(serviceName)}/mitigation`,
    { cache: "no-store" }
  );
  return _json(res);
}

export async function serviceMitigationHistory(serviceName) {
  const res = await fetch(
    `/api/services/${encodeURIComponent(serviceName)}/mitigation/history`,
    { cache: "no-store" }
  );
  return _json(res);
}
