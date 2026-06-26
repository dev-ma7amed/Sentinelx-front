import { ALERTS_PLAIN } from "../data/alertsData";
import {
  assignAlert as platformAssignAlert,
  escalateAlert as platformEscalateAlert,
  getAlerts as platformGetAlerts,
  investigateAlert as platformInvestigateAlert,
  updateStoredAlert,
} from "../platformStore";

const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);

const SEVERITY_WEIGHTS = {
  critical: 40,
  high: 30,
  medium: 20,
  low: 10,
};

function detectMitre(a) {
  const text = `${a.desc || ""} ${a.sub || ""} ${a.type || ""}`.toLowerCase();
  if (text.includes("scan") || text.includes("recon")) return { id: "T1046", name: "Network Service Scanning" };
  if (text.includes("ssh") || text.includes("login") || text.includes("brute")) return { id: "T1110", name: "Brute Force" };
  if (text.includes("injection") || text.includes("process")) return { id: "T1055", name: "Process Injection" };
  if (text.includes("dns") || text.includes("traffic") || text.includes("c2")) return { id: "T1071", name: "Application Layer Protocol" };
  return null;
}

function normalizeAlert(a) {
  const rawSev = String(a.severity || "").toLowerCase().trim();
  const severity = VALID_SEVERITIES.has(rawSev) ? rawSev : "medium";
  const createdAt =
    a.createdAt && Date.parse(a.createdAt) > 0
      ? a.createdAt
      : a.date && a.time
      ? `${a.date}T${a.time}Z`
      : new Date().toISOString();

  const dateObj = new Date(createdAt);
  let date = a.date;
  let time = a.time;
  let timeAgo = a.timeAgo;

  if (!date || !time) {
    if (!Number.isNaN(dateObj.getTime())) {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getDate()).padStart(2, "0");
      date = `${year}-${month}-${day}`;

      const hours = String(dateObj.getHours()).padStart(2, "0");
      const minutes = String(dateObj.getMinutes()).padStart(2, "0");
      const seconds = String(dateObj.getSeconds()).padStart(2, "0");
      time = `${hours}:${minutes}:${seconds}`;
    }
  }

  if (!timeAgo && !Number.isNaN(dateObj.getTime())) {
    const diffMs = Date.now() - dateObj.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) {
      timeAgo = "just now";
    } else if (diffMin < 60) {
      timeAgo = `${diffMin}m ago`;
    } else {
      const diffHours = Math.round(diffMin / 60);
      if (diffHours < 24) {
        timeAgo = `${diffHours}h ago`;
      } else {
        const diffDays = Math.round(diffHours / 24);
        timeAgo = `${diffDays}d ago`;
      }
    }
  }

  const mitre = a.mitre || detectMitre(a);
  const srcKey = a.srcIP || a?.data?.srcip || "unknown";
  const correlationId = a.correlationId || `corr-${String(srcKey).replace(/\./g, "-")}`;
  const incidentId = a.incidentId != null ? a.incidentId : a.incident_id != null ? a.incident_id : null;
  let baseStatus = a.status || "new";
  if (incidentId) {
    let localIncidents = [];
    let localCases = [];
    if (typeof window !== "undefined") {
      try {
        const rawInc = localStorage.getItem("soc_incidents");
        localIncidents = rawInc ? JSON.parse(rawInc) : [];
        const rawCas = localStorage.getItem("soc_cases");
        localCases = rawCas ? JSON.parse(rawCas) : [];
      } catch (e) {}
    }
    const inc = Array.isArray(localIncidents) ? localIncidents.find(i => String(i.id) === String(incidentId)) : null;
    const linkedCase = Array.isArray(localCases) ? localCases.find(c => String(c.incidentId) === String(incidentId) || String(c.incident_id) === String(incidentId)) : null;
    
    const hasCase = linkedCase || (inc && inc.case_id);
    
    if (hasCase) {
      const isCaseClosed = linkedCase && String(linkedCase.status).toLowerCase() === "closed";
      const isIncidentClosed = inc && String(inc.status).toLowerCase() === "closed";
      
      if (isCaseClosed || isIncidentClosed) {
        baseStatus = "resolved";
      } else {
        baseStatus = "escalated";
      }
    }
  }
  return {
    ...a,
    severity,
    source: a.source || "Suricata",
    status: baseStatus.toLowerCase().trim(),
    srcIP: srcKey,
    createdAt,
    mitre,
    correlationId,
    incidentId,
    date,
    time,
    timeAgo,
  };
}

export function getAlerts() {
  const rows = typeof window !== "undefined" ? platformGetAlerts() : [];
  const base = Array.isArray(rows) && rows.length ? rows : [...ALERTS_PLAIN];
  const alerts = base.map((a) => normalizeAlert(a));
  console.log("FINAL ALERTS:", alerts);
  return alerts;
}

export function getSeverityCounts(alerts) {
  return alerts.reduce(
    (acc, a) => {
      const s = a.severity;

      if (s === "critical") acc.critical++;
      else if (s === "high") acc.high++;
      else if (s === "medium") acc.medium++;
      else if (s === "low") acc.low++;

      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );
}

export function generateIncidents(alerts) {
  const grouped = {};

  alerts.forEach((a) => {
    const key =
      a.srcIP ||
      a.srcip ||
      a.src_ip ||
      a.data?.srcip ||
      a.data?.src_ip ||
      a.sourceIP;

    if (!key) return;

    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  });

  console.log("INCIDENTS GENERATED:", grouped);

  return Object.entries(grouped).map(([ip, list]) => {
    const correlationScore = computeCorrelationScore(list);

    // Aggregate unique MITRE techniques
    const mitreTechniques = [];
    const seenMitre = new Set();
    list.forEach((a) => {
      if (a.mitre) {
        const id = typeof a.mitre === "object" ? a.mitre.id : a.mitre;
        if (id && !seenMitre.has(id)) {
          seenMitre.add(id);
          mitreTechniques.push(typeof a.mitre === "object" ? a.mitre : { id, name: id });
        }
      }
    });

    return {
      id: `INC-${ip.replace(/\./g, "")}`,
      ip,
      srcIP: ip,
      alerts: list,
      alertIds: list.map((a) => a.id).filter(Boolean),
      mitreTechniques,
      severity: list.some((a) => a.severity === "critical")
        ? "critical"
        : list.some((a) => a.severity === "high")
          ? "high"
          : "medium",
      count: list.length,
      correlationScore,
      status: "needs-review",
      reviewStatus: "review",
      autoCaseCreated: false,
      createdAt: list[0]?.createdAt || new Date().toISOString(),
    };
  });
}

export function updateAlert(alertId, updater) {
  if (typeof window !== "undefined") {
    const merged = updateStoredAlert(alertId, (raw) => {
      const current = normalizeAlert({ ...raw });
      return typeof updater === "function" ? updater(current) : { ...current, ...(updater || {}) };
    });
    return merged ? normalizeAlert(merged) : null;
  }
  const index = ALERTS_PLAIN.findIndex((alert) => alert?.id === alertId);
  if (index < 0) return null;
  const current = normalizeAlert(ALERTS_PLAIN[index]);
  const next = typeof updater === "function" ? updater(current) : { ...current, ...(updater || {}) };
  ALERTS_PLAIN[index] = { ...ALERTS_PLAIN[index], ...next };
  return normalizeAlert(ALERTS_PLAIN[index]);
}

export const assignAlert = platformAssignAlert;
export const investigateAlert = platformInvestigateAlert;
export const escalateAlert = platformEscalateAlert;

export function getDayName(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function buildTrendData(alerts) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const alertsPerDay = {};
  const resolvedPerDay = {};

  days.forEach((day) => {
    alertsPerDay[day] = 0;
    resolvedPerDay[day] = 0;
  });

  alerts.forEach((a) => {
    const day = getDayName(a.createdAt || (a.date && a.time ? `${a.date}T${a.time}` : a.date));
    if (!alertsPerDay[day] && alertsPerDay[day] !== 0) return;
    alertsPerDay[day]++;
    if (a.status === "resolved") resolvedPerDay[day]++;
  });

  return {
    labels: days,
    alerts: days.map((day) => alertsPerDay[day]),
    resolved: days.map((day) => resolvedPerDay[day]),
  };
}

export function getTelemetry(alerts) {
  const total = alerts.length || 1;
  const sources = {
    Wazuh: 0,
    Sysmon: 0,
    Suricata: 0,
    "Network ML": 0,
  };

  alerts.forEach((a) => {
    if (sources[a.source] !== undefined) {
      sources[a.source]++;
    }
  });

  return Object.entries(sources).map(([name, count]) => ({
    name,
    value: Math.round((count / total) * 100),
  }));
}

export function computeCorrelationScore(alertList) {
  if (!Array.isArray(alertList) || alertList.length === 0) return 0;

  let score = 0;
  alertList.forEach(a => {
    if (a.severity === "critical") score += 35;
    else if (a.severity === "high") score += 25;
    else if (a.severity === "medium") score += 15;
    else score += 5;
  });

  return Math.min(score, 95);
}
