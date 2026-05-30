import { ALERTS_PLAIN } from "./mocks/alertsPlain.jsx";
import { getCurrentUser } from "./session";
import { 
    getAlertsList, 
    getIncidentsList, 
    getCasesList, 
    assignAlert as apiAssignAlert, 
    investigateAlert as apiInvestigateAlert,
    escalateAlert as apiEscalateAlert,
    classifyIncident as apiClassifyIncident,
    createCase as apiCreateCase,
    addCaseNote as apiAddCaseNote,
    escalateCase as apiEscalateCase,
    closeCase as apiCloseCase,
    assignCase as apiAssignCase,
    getBackendAuditLogs,
    getBackendIntegrations,
    getBackendNotifications,
    getDetectionRules,
    updateBackendIntegration,
    getMitreMapping
} from "./api/socService";

const LS_ALERTS = "soc_alerts";
const LS_INCIDENTS = "soc_incidents";
const LS_AUDIT = "soc_audit_log";
const LS_INCIDENT_AUDIT = "soc_incident_audit_logs";
const LS_NOTIFS = "soc_notifications";
const LS_RULES = "soc_rules";
const LS_INTEGRATIONS = "soc_integrations";
const LS_CASES = "soc_cases";
const LS_STORE_VERSION = "soc_store_version";
const CURRENT_STORE_VERSION = 100; // Force reset on every load

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHORITATIVE STATE OVERRIDE - Force fresh data on app start
// ═══════════════════════════════════════════════════════════════════════════════
function forceStorageReset() {
    try {
        const storedVersion = localStorage.getItem(LS_STORE_VERSION);

        // If version mismatch, clear all persisted data
        if (storedVersion !== String(CURRENT_STORE_VERSION)) {
            console.log("🔄 FORCING STORAGE RESET - Version mismatch detected");
            console.log("Stored version:", storedVersion, "Current version:", CURRENT_STORE_VERSION);

            // Clear all persisted state
            localStorage.removeItem(LS_ALERTS);
            localStorage.removeItem(LS_INCIDENTS);
            localStorage.removeItem(LS_CASES);
            localStorage.removeItem(LS_AUDIT);
            localStorage.removeItem(LS_INCIDENT_AUDIT);
            localStorage.removeItem(LS_NOTIFS);
            localStorage.removeItem(LS_RULES);
            localStorage.removeItem(LS_INTEGRATIONS);
            localStorage.removeItem("platform_store");
            localStorage.removeItem("persisted-platform");

            // Set new version
            localStorage.setItem(LS_STORE_VERSION, String(CURRENT_STORE_VERSION));

            console.log("✅ Storage reset complete - Fresh data will be loaded");
            return true;
        }
    } catch (e) {
        console.error("Error in forceStorageReset:", e);
    }
    return false;
}

// Force reset on module load
if (typeof window !== "undefined") {
    forceStorageReset();
}

const NOTIF_SEED = [
    { id: "n-seed-1", text: "SOC platform initialized", read: false, at: Date.now(), category: "general" },
];

const RULES_SEED = [
    { id: "r1", name: "Brute Force", match: /failed login|authentication failure|invalid user|brute/i, source: "Wazuh", severity: "high", mitre: "T1110", threshold: 5, window: 60000 },
    { id: "r2", name: "Recon Activity", match: /scan|port scan|syn scan|signature/i, source: "", severity: "low", mitre: "T1046", threshold: 3, window: 300000 },
    { id: "r3", name: "Execution", match: /powershell|cmd\.exe|process|injection|lsass|script/i, source: "", severity: "high", mitre: "T1059", threshold: null, window: null },
    { id: "r4", name: "Command and Control", match: /c2|beacon|command and control|malicious traffic|outbound|dns tunnel|suspicious traffic/i, source: "", severity: "critical", mitre: "T1071", threshold: null, window: null },
    { id: "r5", name: "ML Anomaly", match: /anomaly|classification|malicious traffic|suspicious traffic/i, source: "Network ML", severity: "high", mitre: "T1071", threshold: 0.7, window: null },
];

const SEVERITY_ORDER = ["low", "medium", "high", "critical"];

let backendRulesCache = RULES_SEED.map(normalizeSeedRule);
let backendIntegrationsCache = {
    wazuh: true,
    sysmon: true,
    suricata: true,
    ml: true,
    network_ml: true,
    virustotal: false,
    abuseipdb: false,
};
let backendNotificationsCache = [];
let backendAuditLogCache = [];

function normalizeSeedRule(rule) {
    return {
        ...rule,
        active: true,
    };
}

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        const data = JSON.parse(raw);
        return data ?? fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function normalizeSeverityValue(s) {
    const v = String(s || "").toLowerCase().trim();

    if (v === "critical") return "critical";
    if (v === "high") return "high";
    if (v === "medium") return "medium";
    if (v === "low") return "low";

    return "low";
}

export function ensureSeedData() {
    const existing = readJson(LS_ALERTS, []);
    if (Array.isArray(existing) && existing.length > 0) return;
    const now = new Date().toISOString();
    const seeded = ALERTS_PLAIN.map((a) => ({
        ...a,
        createdAt: a.createdAt || now,
    }));
    writeJson(LS_ALERTS, seeded);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("soc_platform_data"));
    }
}

export function forceResetAlerts() {
    writeJson(LS_ALERTS, ALERTS_PLAIN);
    emitPlatformDataChanged();
}

export function forceResetCases() {
    writeJson(LS_CASES, []);
    emitPlatformDataChanged();
}

export function forceResetIncidents() {
    writeJson(LS_INCIDENTS, []);
    emitPlatformDataChanged();
}

export function forceResetAll() {
    forceResetAlerts();
    forceResetCases();
    forceResetIncidents();
    localStorage.removeItem(LS_AUDIT);
    localStorage.removeItem(LS_INCIDENT_AUDIT);
    localStorage.removeItem(LS_NOTIFS);
    hydrationComplete = false;
    hydrateSocPipeline();
}

export function resetToDemo() {
    const incidents = getIncidents();
    const resetIncidents = incidents.map(i => ({
        ...i,
        status: "open",
        caseId: null,
        autoEscalated: false,
        escalatedByUser: false,
        classification: null,
        closedAt: ""
    }));
    setIncidents(resetIncidents);

    const cases = getCases();
    const resetCases = cases.map(c => ({
        ...c,
        status: "triage",
        closedAt: ""
    }));
    setCases(resetCases);

    localStorage.removeItem(LS_AUDIT);
    localStorage.removeItem(LS_INCIDENT_AUDIT);
    localStorage.removeItem(LS_NOTIFS);

    emitPlatformDataChanged();
}

function emitNotifications(list) {
    try {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("soc_notifications_update", { detail: { notifications: list } }));
    } catch (error) {
        console.error("Error emitting notifications:", error);
    }
}

function emitPlatformDataChanged() {
    try {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new Event("soc_platform_data"));
    } catch (error) {
        console.error("Error emitting platform data change:", error);
    }
}

function uniq(list) {
    return Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function pickText(...values) {
    for (const value of values) {
        if (value == null) continue;
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed) return trimmed;
            continue;
        }
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
        if (typeof value === "boolean") return String(value);
    }
    return "";
}

function safeArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null || value === "") return [];
    return [value];
}

function stableHash(value) {
    let hash = 0;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

export function normalizeSeverity(value) {
    if (value === null || value === undefined || value === "") return "low";
    if (typeof value === "number" && Number.isFinite(value)) return levelToSeverity(value);
    const str = String(value).trim();
    if (str !== "" && /^\d+(\.\d+)?$/.test(str)) return levelToSeverity(Number(str));
    const v = str.toLowerCase();
    if (SEVERITY_ORDER.includes(v)) return v;
    if (v.includes("crit")) return "critical";
    if (v.includes("high")) return "high";
    if (v.includes("med")) return "medium";
    if (v.includes("low")) return "low";
    return "low";
}

function severityRank(value) {
    return Math.max(0, SEVERITY_ORDER.indexOf(normalizeSeverity(value)));
}

function levelToSeverity(level) {
    const n = Number(level);
    if (!Number.isFinite(n)) return "low";
    if (n >= 13) return "critical";
    if (n >= 9) return "high";
    if (n >= 5) return "medium";
    return "low";
}

function capitalize(value) {
    const v = String(value || "");
    return v ? `${v.charAt(0).toUpperCase()}${v.slice(1)}` : "";
}

function canonicalSource(value, alert = {}) {
    const raw = pickText(
        value,
        alert.source,
        alert.sourceName,
        alert.provider,
        alert.sensor,
        alert.decoder?.name,
        alert.integration,
    ).toLowerCase();

    if (raw.includes("sysmon")) return "Sysmon";
    if (raw.includes("suricata")) return "Suricata";
    if (raw.includes("network ml") || raw.includes("ml classification") || raw === "ml") return "Network ML";
    if (raw.includes("wazuh")) return "Wazuh";
    return pickText(value, alert.source) || "Unknown";
}

function normalizeStatus(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "unassigned") return "unassigned";
    if (raw === "escalated") return "escalated";
    if (!raw || raw === "open" || raw === "new") return "new";
    if (["triage", "investigating", "investigation", "in progress", "in-progress", "pending"].includes(raw)) return "in-progress";
    if (["resolved", "closed", "archived"].includes(raw)) return "resolved";
    return "new";
}

function alertHasIncidentId(alert) {
    const v = alert?.incidentId;
    return v != null && String(v).trim() !== "";
}

/** Row actions from alert state only (no static per-source lists). */
export function inferAlertActions(alert) {
    const st = String(alert?.status || "").toLowerCase();
    const link = alertHasIncidentId(alert);

    if (st === "resolved") {
        return link ? ["view-case"] : [];
    }
    if (st === "new") {
        const row = ["escalate", "investigate"];
        if (link) row.push("view-case");
        return row;
    }
    if (st === "in-progress" || st === "escalated") {
        const row = ["investigate"];
        if (link) row.push("view-case");
        return row;
    }
    const row = [];
    if (link) row.push("view-case");
    return row.length ? row : ["escalate", "investigate"];
}

function parseTimeAgo(value) {
    const raw = String(value || "").trim().toLowerCase();
    const match = raw.match(/(\d+)\s*([smhdw])/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const unitMs = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
    }[unit];
    if (!unitMs) return null;
    return new Date(Date.now() - (amount * unitMs)).toISOString();
}

function normalizeIso(value) {
    if (value == null || value === "") return "";
    const date = value instanceof Date ? value : new Date(value);
    const ms = date.getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function resolveCreatedAt(alert) {
    const a = alert && typeof alert === "object" ? alert : {};
    if (!a._createdAt) {
        a._createdAt = new Date().toISOString();
    }
    return a._createdAt;
}

function formatTimeAgo(iso) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return "";
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 30 * 1000) return "just now";
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function flattenMitre(value) {
    if (!value) return [];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(flattenMitre);
    if (typeof value === "object") {
        return flattenMitre(
            value.id
            || value.technique
            || value.techniques
            || value.attack
            || value.value
        );
    }
    return [];
}

function alertText(alert) {
    const a = alert && typeof alert === "object" ? alert : {};
    return [
        a.type,
        a.desc,
        a.sub,
        a.rule?.description,
        a.message,
        a.full_log,
        a.data?.message,
    ].map((value) => pickText(value)).filter(Boolean).join(" ");
}

function testRegex(regex, text) {
    if (!(regex instanceof RegExp)) return false;
    const t = text == null ? "" : String(text).toLowerCase();
    try {
        return new RegExp(regex.source, "i").test(t);
    } catch {
        return false;
    }
}

function parseAlertTimeMs(alert) {
    const iso = resolveCreatedAt(alert && typeof alert === "object" ? alert : {});
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
}

function compareAlertsByTime(left, right) {
    const diff = parseAlertTimeMs(left) - parseAlertTimeMs(right);
    if (diff !== 0) return diff;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function uniqueAlerts(alerts) {
    const map = new Map();
    (Array.isArray(alerts) ? alerts : []).filter(Boolean).forEach((alert) => {
        const normalized = normalizeAlert(alert);
        const key = pickText(normalized.id) || JSON.stringify([
            normalized.source,
            normalized.srcIP,
            normalized.dstIP,
            normalized.type,
            normalized.createdAt,
        ]);
        if (!map.has(key)) {
            map.set(key, normalized);
        }
    });
    return [...map.values()].sort(compareAlertsByTime);
}

function alertPrimaryIp(alert) {
    return (
        alert?.srcIP ||
        alert?.data?.srcip ||
        alert?.srcip ||
        alert?.ip ||
        "unknown"
    );
}

function detectAlertStages(alert) {
    const a = alert && typeof alert === "object" ? alert : {};
    const text = alertText(a).toLowerCase();
    const src = String(a.source || "").toLowerCase();
    const stages = [];
    const isWazuh = src.includes("wazuh") || !!(a.agent || a.manager || a.rule?.groups);
    const isSysmon = src.includes("sysmon") || /sysmon|eventid|processcreate|networkconnection/i.test(text);
    const isMl = src.includes("network ml") || src === "ml" || /ml classification|anomaly score|flow classification/i.test(text);
    const isSuricata = a.source === "Suricata" || src.includes("suricata") || /suricata/i.test(String(a.sensor || a.decoder?.name || "").toLowerCase());

    if (isSuricata) {
        if (/\bscan\b|port\s*scan|syn\s*scan|portscan|recon|potential\s+port/i.test(text)) stages.push("Recon");
        if (/exploit|attack|injection/i.test(text)) stages.push("Execution");
        if (/\bdns\b|outbound|malicious\s+traffic|\bc2\b|command\s+and\s+control|dns\s+tunnel/i.test(text)) stages.push("C2");
    }

    if (
        /scan|port|signature|recon|network scan|syn scan|potential port|ids|suricata/i.test(text)
        || (a.source === "Suricata" && /network|scan|alert|signature/i.test(text))
        || (isWazuh && /scan|recon|port|firewall|iptables/i.test(text))
    ) stages.push("Recon");

    if (
        /failed login|authentication failure|brute|invalid user|ssh|pam|sudo|password|logon|account|auth/i.test(text)
        || (isWazuh && /authentication|syscheck|fim|integrity|passwd/i.test(text))
    ) stages.push("Access");

    if (
        /process|powershell|cmd\.exe|injection|lsass|script|execution|createprocess|child process|malware|ransomware|registry|driver/i.test(text)
        || (isSysmon && /process|image|commandline|parent/i.test(text))
    ) stages.push("Execution");

    if (
        /c2|beacon|command and control|malicious traffic|outbound|dns tunnel|suspicious traffic|exfil|callback/i.test(text)
        || isMl
        || (a.source === "Network ML")
    ) stages.push("C2");

    return uniq(stages);
}

const INCIDENT_STAGE_ORDER = ["Recon", "Access", "Execution", "C2"];

function coerceIncidentStages(stages) {
    if (!Array.isArray(stages)) return [];
    const trimmed = stages
        .filter((s) => s != null && String(s).trim() !== "")
        .map((s) => String(s).trim());
    const uniqStages = [...new Set(trimmed)];
    const ordered = INCIDENT_STAGE_ORDER.filter((label) => uniqStages.includes(label));
    const extras = uniqStages.filter((label) => !INCIDENT_STAGE_ORDER.includes(label));
    return [...ordered, ...extras];
}

function buildIncidentType(stages, sourceCount = 0) {
    const s = coerceIncidentStages(stages);
    const srcN = Math.max(0, Number(sourceCount) || 0);

    let label;
    if (s.length >= 2) {
        label = "Multi-Stage Attack (Recon → Access → Execution → C2)";
    } else if (s.length === 1) label = "Execution Activity";
    else label = "Unclassified Threat";

    if (srcN > 1) label = `${label} • Multi-Source Correlation`;
    return label;
}

function canonicalSourcesFromAlerts(alerts) {
    return uniq((Array.isArray(alerts) ? alerts : []).map((a) => canonicalSource(a?.source, a)).filter(Boolean));
}

function calculateIncidentRiskScore(severity, alerts, sources, stageCount) {
    const baseSeverity = severityRank(severity) + 1;
    const a = Array.isArray(alerts) ? alerts.length : 0;
    const src = Array.isArray(sources) ? sources.length : 0;
    const st = Math.max(0, Number(stageCount) || 0);
    const risk = (baseSeverity * 20) + (a * 5) + (src * 10) + (st * 10);
    return clamp(Math.round(risk), 0, 100);
}

function hasHostAndNetworkCrossCoverage(sources) {
    const labels = uniq((Array.isArray(sources) ? sources : []).map((s) => canonicalSource(s)));
    const host = labels.some((s) => s === "Wazuh" || s === "Sysmon");
    const net = labels.some((s) => s === "Suricata" || s === "Network ML");
    return host && net;
}

function calculateIncidentConfidence(alerts, sources, stageCount) {
    const a = Array.isArray(alerts) ? alerts.length : 0;
    const src = Array.isArray(sources) ? sources.length : 0;
    const st = Math.max(0, Number(stageCount) || 0);
    let score = 12 + (a * 5) + (src * 10) + (st * 10);
    if (hasHostAndNetworkCrossCoverage(sources)) score += 8;
    return clamp(Math.round(score), 10, 99);
}

function calculateIncidentCorrelationScore(severity, alerts, sources, stageCount) {
    const a = Array.isArray(alerts) ? alerts.length : 0;
    const src = Array.isArray(sources) ? sources.length : 0;
    const st = Math.max(0, Number(stageCount) || 0);
    const baseSeverity = severity === "critical" ? 48 : severity === "high" ? 34 : severity === "medium" ? 22 : 12;
    let score = baseSeverity + (a * 8) + (src * 6) + (st * 5);
    if (hasHostAndNetworkCrossCoverage(sources)) score += 6;
    return clamp(Math.round(score), 0, 100);
}

function normalizeRule(rule) {
    const backendMatch = rule?.field_match
        ? String(rule.field_match)
            .split(/\s+AND\s+/i)
            .map((part) => part.match(/CONTAINS\s+["']?(.+?)["']?$/i)?.[1])
            .filter(Boolean)
            .join("|")
        : "";
    const pattern = rule?.match || backendMatch;
    const regex = pattern instanceof RegExp
        ? new RegExp(pattern.source, pattern.flags.replaceAll("g", ""))
        : new RegExp(String(pattern || ".^"), "i");
    return {
        ...rule,
        match: regex,
        source: rule?.source ? canonicalSource(rule.source) : "",
        severity: normalizeSeverity(rule?.severity || rule?.severity_override),
        threshold: rule?.threshold ?? rule?.threshold_count ?? null,
        window: rule?.window ?? rule?.windowMs ?? ((rule?.time_window_seconds || 0) * 1000) ?? null,
    };
}

function thresholdSatisfied(rule, alert, alerts) {
    const a = alert && typeof alert === "object" ? alert : {};
    if (typeof rule.threshold !== "number") return true;

    if (a.source === "Network ML" && rule.threshold <= 1) {
        const score = Number(a.ml_score ?? a.confidence ?? 0);
        const normalizedScore = score > 1 ? score / 100 : score;
        return normalizedScore >= rule.threshold;
    }

    if (rule.threshold <= 1) return true;

    const key = alertPrimaryIp(a) || pickText(a.hostname, a.user, a.id);
    const windowMs = typeof rule.window === "number" ? rule.window : 0;
    const baseTime = parseAlertTimeMs(a);
    const count = (Array.isArray(alerts) ? alerts : [a]).filter((candidate) => {
        const normalizedCandidate = normalizeAlert(candidate);
        const candidateKey = alertPrimaryIp(normalizedCandidate) || pickText(normalizedCandidate.hostname, normalizedCandidate.user, normalizedCandidate.id);
        if (candidateKey !== key) return false;
        if (rule.source && canonicalSource(normalizedCandidate.source, normalizedCandidate) !== rule.source) return false;
        if (!testRegex(rule.match, alertText(normalizedCandidate).toLowerCase())) return false;
        return !windowMs || Math.abs(parseAlertTimeMs(normalizedCandidate) - baseTime) <= windowMs;
    }).length;

    if (count >= rule.threshold) return true;
    return /multiple|repeated|burst|excessive|many/i.test(alertText(a));
}

function normalizeIntegrationMap(list) {
    const base = {
        wazuh: true,
        sysmon: true,
        suricata: true,
        ml: true,
        network_ml: true,
        virustotal: false,
        abuseipdb: false,
    };

    if (Array.isArray(list)) {
        return list.reduce((acc, item) => {
            const key = item?.name === "network_ml" ? "ml" : item?.name;
            if (key) acc[key] = !!item.enabled;
            if (item?.name === "network_ml") acc.network_ml = !!item.enabled;
            return acc;
        }, { ...base });
    }

    return {
        ...base,
        ...Object.fromEntries(Object.entries(list || {}).map(([key, value]) => [key, !!value])),
    };
}

export function getIntegrations() {
    return { ...backendIntegrationsCache };
}

export function setIntegrations(next) {
    const previous = { ...backendIntegrationsCache };
    const normalized = normalizeIntegrationMap(next);
    backendIntegrationsCache = normalized;

    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("soc_integrations_update"));
    }

    Object.entries(normalized).forEach(([key, enabled]) => {
        if (previous[key] === enabled) return;
        const apiName = key === "ml" ? "network_ml" : key;
        updateBackendIntegration(apiName, { enabled }).catch((error) => {
            console.error("Failed to update integration:", error);
            backendIntegrationsCache = previous;
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("soc_integrations_update"));
            }
        });
    });
}

function inferNotificationCategory(text, meta = {}) {
    if (meta.category) return meta.category;
    const t = String(text || "").toLowerCase();
    if (/correlated incident|new correlated|incident .+ assigned|incident .+ classified|investigation|no correlated incident/.test(t)) return "incident";
    if (/case .+ created|from incident|escalat|case .+ classified|case .+ assigned|case .+ deleted/.test(t)) return "case";
    if (/blocked|terminated|isolated|disabled|containment|kill|firewall|domain blocked|logged in|api key|integration/.test(t)) return "response";
    return "general";
}

export function normalizeAlert(alert) {
    const base = alert && typeof alert === "object" ? alert : {};
    const { sourceIcon: _sourceIcon, ...rest } = base;
    const createdAt = resolveCreatedAt(rest);
    const dateObj = new Date(createdAt);
    const hasRuleLevel = rest.rule?.level != null && String(rest.rule.level).trim() !== "";
    const fromLevel = hasRuleLevel ? levelToSeverity(rest.rule.level) : null;
    const fromRuleSeverity = !hasRuleLevel && rest.rule?.severity != null && String(rest.rule.severity).trim() !== ""
        ? normalizeSeverity(rest.rule.severity)
        : null;
    const fromRawSeverity = rest.rawSeverity != null && String(rest.rawSeverity).trim() !== ""
        ? normalizeSeverity(rest.rawSeverity)
        : null;
    const fromAlertSeverity = rest.severity != null && String(rest.severity).trim() !== ""
        ? normalizeSeverity(rest.severity)
        : null;
    const rawSeverity = fromLevel ?? fromRuleSeverity ?? fromRawSeverity ?? fromAlertSeverity ?? "low";
    const normalizedSeverity = hasRuleLevel
        ? fromLevel
        : (Array.isArray(rest.ruleMatches) && rest.ruleMatches.length
            ? normalizeSeverity(rest.severity)
            : rawSeverity);
    const source = canonicalSource(rest.source, rest);
    const srcIP = pickText(
        rest.srcIP,
        rest.srcip,
        rest.src_ip,
        rest.source_ip,
        rest.sourceIp,
        rest.data?.srcip,
        rest.data?.src_ip,
        rest.data?.source_ip,
    );
    const dstIP = pickText(
        rest.dstIP,
        rest.dstip,
        rest.dst_ip,
        rest.destination_ip,
        rest.destinationIp,
        rest.data?.dstip,
        rest.data?.dst_ip,
        rest.data?.destination_ip,
    );
    const hostname = pickText(
        rest.hostname,
        rest.host,
        rest.hostName,
        rest.agent?.name,
        rest.data?.hostname,
        rest.data?.host,
        rest.computer_name,
        rest.computerName,
    );
    const user = pickText(
        rest.user,
        rest.username,
        rest.account,
        rest.data?.user,
        rest.data?.username,
        rest.data?.dstuser,
        rest.data?.srcuser,
        rest.win?.eventdata?.targetUserName,
    );
    const type = pickText(
        rest.type,
        rest.event_type,
        rest.rule?.description,
    ) || "Security Alert";
    const desc = pickText(
        rest.desc,
        rest.description,
        rest.rule?.description,
        rest.message,
        rest.full_log,
        rest.fullLog,
        rest.signature,
        type,
    );
    const sub = pickText(
        rest.sub,
        Array.isArray(rest.rule?.groups) ? rest.rule.groups.join(", ") : "",
        rest.data?.protocol,
        rest.data?.proto,
        rest.location,
        rest.agent?.name ? `Agent: ${rest.agent.name}` : "",
        rest.linkedAlertId ? `Linked alert: ${rest.linkedAlertId}` : "",
    );
    const baseId =
        rest.id ||
        rest._id ||
        `${canonicalSource(rest.source, rest)}-${rest.data?.srcip || rest.srcIP || "unknown"}-${resolveCreatedAt(rest)}`;
    const id = String(baseId).replace(/\s+/g, "-");

    const incidentId = rest.incidentId || rest.incident_id || null;
    let baseStatus = rest.status || "new";
    if (incidentId) {
        let localIncidents = [];
        let localCases = [];
        try {
            const rawInc = localStorage.getItem("soc_incidents");
            localIncidents = rawInc ? JSON.parse(rawInc) : [];
            const rawCas = localStorage.getItem("soc_cases");
            localCases = rawCas ? JSON.parse(rawCas) : [];
        } catch (e) {}
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

    const normalized = {
        ...rest,
        id,
        srcIP,
        dstIP,
        severity: normalizedSeverity,
        rawSeverity,
        source,
        createdAt,
        date: createdAt.slice(0, 10),
        time: createdAt.slice(11, 19),
        timeAgo: pickText(rest.timeAgo),
        hostname,
        user,
        type,
        desc,
        sub,
        status: normalizeStatus(baseStatus),
        incidentId,
        actions: inferAlertActions({
            ...rest,
            id,
            source,
            status: normalizeStatus(baseStatus),
            incidentId,
        }),
        ruleMatches: uniq(safeArray(rest.ruleMatches)),
        mitre: uniq([
            ...flattenMitre(rest.mitre),
            ...flattenMitre(rest.rule?.mitre),
            ...flattenMitre(rest.data?.mitre),
        ]),
    };

    if (!Number.isNaN(dateObj.getTime())) {
        normalized.date = dateObj.toISOString().slice(0, 10);
        normalized.time = dateObj.toISOString().slice(11, 19);
    }

    return normalized;
}

export function getRules() {
    return (Array.isArray(backendRulesCache) && backendRulesCache.length ? backendRulesCache : RULES_SEED).map(normalizeRule);
}

export function applyRulesToAlert(alert, allAlerts = null) {
    const normalizedAlert = normalizeAlert(alert);
    const pool = Array.isArray(allAlerts) ? allAlerts.map(normalizeAlert) : [normalizedAlert];
    if (normalizedAlert.source === "Network ML") {
        return {
            ...normalizedAlert,
            severity: normalizeSeverity(normalizedAlert.severity || "medium"),
        };
    }
    const text = alertText(normalizedAlert).toLowerCase();
    const hasRuleLevel = normalizedAlert.rule?.level != null && String(normalizedAlert.rule.level).trim() !== "";
    const fromLevel = hasRuleLevel ? levelToSeverity(normalizedAlert.rule.level) : null;
    const fromRuleSeverity = !hasRuleLevel && normalizedAlert.rule?.severity != null && String(normalizedAlert.rule.severity).trim() !== ""
        ? normalizeSeverity(normalizedAlert.rule.severity)
        : null;
    const fromRawSeverity = normalizedAlert.rawSeverity != null && String(normalizedAlert.rawSeverity).trim() !== ""
        ? normalizeSeverity(normalizedAlert.rawSeverity)
        : null;
    const noMatchSeverity = fromLevel ?? fromRuleSeverity ?? fromRawSeverity ?? "low";
    const matched = getRules().filter((rule) => {
        if (rule.source && canonicalSource(normalizedAlert.source, normalizedAlert) !== rule.source) return false;
        if (!testRegex(rule.match, text)) return false;
        return thresholdSatisfied(rule, normalizedAlert, pool);
    });
    let severity;
    if (matched.length) {
        severity = matched.reduce(
            (best, rule) => (severityRank(rule.severity) > severityRank(best) ? rule.severity : best),
            normalizeSeverity(matched[0].severity),
        );
    } else {
        severity = noMatchSeverity;
    }
    return {
        ...normalizedAlert,
        ruleMatches: uniq([...safeArray(normalizedAlert.ruleMatches), ...matched.map((rule) => rule.name)]),
        mitre: uniq([...normalizedAlert.mitre, ...matched.map((rule) => rule.mitre).filter(Boolean)]),
        severity,
    };
}

export function prepareAlerts(alerts) {
    try {
        const normalized = (Array.isArray(alerts) ? alerts : []).filter(Boolean).map(normalizeAlert);
        const result = normalized.map((alert) => applyRulesToAlert(alert, normalized));
        return uniqueAlerts(result);
    } catch (e) {
        console.error(e);
        return [];
    }
}

export function filterAlertsByIntegrations(alerts) {
    const integ = getIntegrations();
    const map = {
        Wazuh: "wazuh",
        Sysmon: "sysmon",
        Suricata: "suricata",
        "Network ML": "ml",
    };
    return (Array.isArray(alerts) ? alerts : [])
        .map(normalizeAlert)
        .filter((alert) => {
            const key = map[canonicalSource(alert.source, alert)];
            if (!key) return true;
            return !!integ?.[key];
        });
}

function readRawAlerts() {
    const seed = ALERTS_PLAIN.map((a) => ({ ...a }));
    const raw = readJson(LS_ALERTS, null);
    if (!Array.isArray(raw) || raw.length === 0) return seed;
    
    const mergedMap = new Map();
    seed.forEach(s => mergedMap.set(String(s.id), s));
    raw.filter(Boolean).forEach(r => {
        const existing = mergedMap.get(String(r.id));
        mergedMap.set(String(r.id), existing ? { ...existing, ...r } : r);
    });
    
    return Array.from(mergedMap.values());
}

function writeRawAlerts(list) {
    writeJson(LS_ALERTS, Array.isArray(list) ? list : []);
    emitPlatformDataChanged();
}

export function getAlerts() {
    return readRawAlerts().map((a) => ({
        ...a,
        severity: normalizeSeverityValue(a?.severity),
    }));
}

/** Merge-update one alert in persisted storage (used by SOC UI actions). */
export function updateStoredAlert(alertId, updater) {
    const raw = readRawAlerts();
    const idx = raw.findIndex((r) => r?.id === alertId);
    if (idx < 0) return null;
    const cur = { ...raw[idx] };
    const next = typeof updater === "function" ? updater(cur) : { ...cur, ...(updater || {}) };
    raw[idx] = { ...cur, ...next };
    writeRawAlerts(raw);
    return raw[idx];
}

export function assignAlert(alertId, assigneeName) {
    apiAssignAlert(alertId, assigneeName)
        .then(() => syncWithBackend())
        .catch((err) => console.error("Real assignAlert failed:", err));

    return updateStoredAlert(alertId, (a) => {
        const out = { ...a, assignedTo: assigneeName };
        const st = String(a.status || "").toLowerCase();
        if (st === "new") out.status = "in-progress";
        return out;
    });
}

export function investigateAlert(alertId) {
    apiInvestigateAlert(alertId)
        .then(() => syncWithBackend())
        .catch((err) => console.error("Real investigateAlert failed:", err));

    const raw = readRawAlerts();
    const t = raw.find((r) => r?.id === alertId);
    if (!t) return { updated: 0 };
    const corr = String(t.correlationId || "").trim();
    if (corr) {
        let n = 0;
        const next = raw.map((a) => {
            if (String(a.correlationId || "").trim() === corr) {
                n += 1;
                return { ...a, status: "in-progress" };
            }
            return a;
        });
        writeRawAlerts(next);
        return { updated: n };
    }
    updateStoredAlert(alertId, (a) => ({ ...a, status: "in-progress" }));
    return { updated: 1 };
}

/** Manual escalation only: mark alert escalated, ensure incident exists, link incidentId on correlated alerts. */
export function escalateAlert(alertId) {
    apiEscalateAlert(alertId)
        .then(() => syncWithBackend())
        .catch((err) => console.error("Real escalateAlert failed:", err));

    const raw = readRawAlerts();
    const t = raw.find((r) => r?.id === alertId);
    if (!t) return null;
    const corr = String(t.correlationId || "").trim();
    const peers = corr
        ? raw.filter((a) => String(a.correlationId || "").trim() === corr)
        : [t];
    let incidents = getIncidents();
    let inc = incidents.find((i) => Array.isArray(i.alertIds) && i.alertIds.includes(alertId));
    if (!inc) {
        const generated = generateIncidents(peers.length ? peers : [t]);
        inc = generated.find((g) => Array.isArray(g.alertIds) && g.alertIds.includes(alertId)) || generated[0];
        if (inc) upsertIncident(inc);
    }
    const incidentId = inc?.id;
    if (!incidentId) return null;
    const next = raw.map((a) => {
        const sameGroup = corr ? String(a.correlationId || "").trim() === corr : a.id === alertId;
        if (!sameGroup) return a;
        if (a.id === alertId) return { ...a, status: "escalated", incidentId };
        return { ...a, incidentId };
    });
    writeRawAlerts(next);
    return { incidentId };
}

export function setAlerts(next) {
    if (!Array.isArray(next)) return;

    const prepared = prepareAlerts(next);
    const prev = readJson(LS_ALERTS, []);

    if (JSON.stringify(prev) === JSON.stringify(prepared)) return;

    writeJson(LS_ALERTS, prepared);

    const incidents = correlateAlerts(prepared);
    writeJson(LS_INCIDENTS, incidents);

    emitPlatformDataChanged();
}

function normalizeIncident(incident) {
    const inc = incident && typeof incident === "object" ? incident : {};
    const alerts = Array.isArray(inc.alerts) ? uniqueAlerts(prepareAlerts(inc.alerts)) : [];
    const alertIds = uniq([...(Array.isArray(alerts) ? alerts : []).map((alert) => alert?.id).filter(Boolean), ...(inc.alertIds || [])]);
    const ip = pickText(inc.ip, inc.affectedMachine?.ip, alertPrimaryIp(alerts?.[0]));
    const severity = normalizeSeverity(inc.severity || alerts.reduce((best, alert) => (severityRank(alert?.severity) > severityRank(best) ? (alert?.severity || best) : best), "low"));
    const sources = uniq([...(inc.sources || []).map((source) => canonicalSource(source)), ...(Array.isArray(alerts) ? alerts : []).map((alert) => alert?.source).filter(Boolean)]);
    const stages = coerceIncidentStages([...(inc.stages || []), ...(Array.isArray(alerts) ? alerts : []).flatMap((alt) => detectAlertStages(alt))]);
    const stageCount = coerceIncidentStages(stages).length;
    const createdAt = normalizeIso(inc.createdAt) || alerts?.[0]?.createdAt || "1970-01-01T00:00:00.000Z";
    const closedAt = normalizeIso(inc.closedAt);
    const status = String(inc.status || (closedAt ? "closed" : "open")).trim().toLowerCase() || "open";
    const confidence = Number.isFinite(Number(inc.confidence))
        ? clamp(Math.round(Number(inc.confidence)), 0, 99)
        : calculateIncidentConfidence(alerts, sources, stageCount);
    const correlationScore = Number.isFinite(Number(inc.correlationScore))
        ? clamp(Math.round(Number(inc.correlationScore)), 0, 100)
        : calculateIncidentCorrelationScore(severity, alerts, sources, stageCount);
    const reviewStatus = "review";
    const riskScore = Number.isFinite(Number(inc.riskScore))
        ? clamp(Math.round(Number(inc.riskScore)), 0, 100)
        : calculateIncidentRiskScore(severity, alerts, sources, stageCount);

    return {
        ...inc,
        id: pickText(inc.id) || `INC-${stableHash(`${ip}${createdAt}`)}`,
        ip,
        alerts,
        alertIds,
        severity,
        confidence,
        correlationScore,
        reviewStatus,
        riskScore,
        correlationEngine: "Multi-Source Correlation Engine v2",
        mitre: uniq([
            ...flattenMitre(inc.mitre),
            ...(Array.isArray(alerts) ? alerts : []).flatMap((alert) => flattenMitre(alert?.mitre)),
        ]).slice(0, 3),
        type: pickText(inc.type) || buildIncidentType(stages, sources.length),
        sources,
        stages,
        affectedMachine: {
            ip,
            hostname: pickText(inc.affectedMachine?.hostname, (Array.isArray(alerts) ? alerts : []).find((alert) => alert?.hostname)?.hostname),
            user: pickText(inc.affectedMachine?.user, (Array.isArray(alerts) ? alerts : []).find((alert) => alert?.user)?.user),
        },
        createdAt,
        closedAt: closedAt || "",
        status,
    };
}

export function getIncidents() {
    const raw = readJson(LS_INCIDENTS, []);
    const list = Array.isArray(raw) ? raw : [];
    return list.map((incident) => {
        const normalized = normalizeIncident(incident);
        return {
            ...normalized,
            status: coerceIncidentStatus(normalized.status, normalized.closedAt),
        };
    });
}

function coerceIncidentStatus(status, closedAt) {
    if (closedAt) return "closed";
    const v = String(status || "").trim().toLowerCase();
    if (v === "closed") return "closed";
    if (v === "resolved") return "resolved";
    if (v === "triage") return "triage";
    if (v === "in-progress" || v === "in_progress" || v === "investigating") return "in-progress";
    if (v === "new") return "open";
    if (v === "open" || v === "needs-review" || v === "auto-escalated") return "open";
    return "open";
}

export function setIncidents(next) {
    if (!Array.isArray(next)) return;

    const normalized = next
        .map((x) => {
            if (!x) return null;
            try {
                const normalized = normalizeIncident(x);
                return {
                    ...normalized,
                    status: coerceIncidentStatus(normalized.status, normalized.closedAt),
                };
            } catch (e) {
                console.error(e);
                return null;
            }
        })
        .filter(Boolean);

    const prev = readJson(LS_INCIDENTS, []);

    if (JSON.stringify(prev) === JSON.stringify(normalized)) return;

    writeJson(LS_INCIDENTS, normalized);

    setTimeout(() => {
        emitPlatformDataChanged();
    }, 0);
}

export function getActiveAnalysisCount() {
    return getIncidents().filter((incident) => incident.status !== "closed").length;
}

export function calculateMTTR() {
    const incidents = getIncidents();
    const resolved = incidents.filter((incident) => incident.closedAt);

    if (resolved.length === 0) return null;

    const total = resolved.reduce((acc, incident) => {
        return acc + (
            new Date(incident.closedAt).getTime() -
            new Date(incident.createdAt).getTime()
        );
    }, 0);

    return Math.round(total / resolved.length / 1000);
}

export function updateIncidentStatusOnAssign(id, assignedTo) {
    const incidentId = String(id || "").trim();
    if (!incidentId) return null;
    const incidents = getIncidents();
    let assignedIncident = null;
    const updated = incidents.map((i) => {
        if (i?.id !== incidentId) return i;
        const nextAssignedTo = assignedTo ?? i.owner ?? i.assignedTo;
        assignedIncident = {
            ...i,
            owner: nextAssignedTo,
            assignedTo: nextAssignedTo,
        };
        return assignedIncident;
    });
    setIncidents(updated);
    return assignedIncident;
}

export function upsertIncident(incident) {
    const candidate = normalizeIncident(incident);
    const existing = getIncidents();
    const windowMs = 5 * 60 * 1000;
    const matchIndex = existing.findIndex((row) => {
        if (row.id === candidate.id) return true;
        if (!row.ip || !candidate.ip || row.ip !== candidate.ip) return false;
        return Math.abs(Date.parse(row.createdAt) - Date.parse(candidate.createdAt)) <= windowMs;
    });

    if (matchIndex >= 0) {
        const current = existing[matchIndex];
        const merged = normalizeIncident({
            ...current,
            ...candidate,
            id: current.id,
            createdAt: Date.parse(current.createdAt) <= Date.parse(candidate.createdAt) ? current.createdAt : candidate.createdAt,
            alerts: prepareAlerts(
                uniq([...(current.alerts || []), ...(candidate.alerts || [])].map((alert) => JSON.stringify(normalizeAlert(alert)))).map((value) => JSON.parse(value)),
            ),
            alertIds: uniq([...(current.alertIds || []), ...(candidate.alertIds || [])]),
            mitre: uniq([...(current.mitre || []), ...(candidate.mitre || [])]),
            sources: uniq([...(current.sources || []), ...(candidate.sources || [])]),
            severity: severityRank(candidate.severity) > severityRank(current.severity) ? candidate.severity : current.severity,
            confidence: undefined,
            riskScore: undefined,
            type: undefined,
            affectedMachine: {
                ip: pickText(current.affectedMachine?.ip, candidate.affectedMachine?.ip, candidate.ip),
                hostname: pickText(current.affectedMachine?.hostname, candidate.affectedMachine?.hostname),
                user: pickText(current.affectedMachine?.user, candidate.affectedMachine?.user),
            },
            status: current.status === "closed" ? current.status : candidate.status,
            closedAt: current.closedAt || candidate.closedAt || "",
        });
        const next = [...existing];
        next[matchIndex] = merged;
        setIncidents(next);
        return { list: next, incident: merged, created: false, updated: true };
    }

    const next = [candidate, ...existing];
    setIncidents(next);
    return { list: next, incident: candidate, created: true, updated: false };
}

function normalizeCase(caseItem) {
    const c = caseItem && typeof caseItem === "object" ? caseItem : {};
    const createdAt = normalizeIso(c.createdAt) || new Date().toISOString();
    const closedAt = normalizeIso(c.closedAt);
    const alerts = Array.isArray(c.alerts) ? prepareAlerts(c.alerts) : [];
    const severityValue = normalizeSeverity(c.severity || c.severityLabel || alerts.reduce((best, alert) => (severityRank(alert?.severity) > severityRank(best) ? (alert?.severity || best) : best), "low"));
    return {
        ...c,
        id: pickText(c.id) || `CR-${stableHash(`${createdAt}|${c.incidentId || ""}`)}`,
        createdAt,
        closedAt: closedAt || "",
        archived: !!c.archived,
        status: String(c.status || "triage").toLowerCase(),
        priority: String(c.priority || severityValue).trim().toLowerCase(),
        severity: severityValue,
        severityLabel: pickText(c.severityLabel) || capitalize(severityValue),
        mitre: uniq([...(c.mitre || []), ...(Array.isArray(alerts) ? alerts : []).flatMap((alert) => alert?.mitre || [])]).slice(0, 3),
        alertIds: uniq([...(c.alertIds || []), ...(Array.isArray(alerts) ? alerts : []).map((alert) => alert?.id).filter(Boolean)]),
        alerts,
        confidence: Number.isFinite(Number(c.confidence)) ? clamp(Math.round(Number(c.confidence)), 0, 99) : null,
        ip: pickText(c.ip, c.affectedMachine?.ip, alertPrimaryIp(alerts?.[0])),
        affectedMachine: {
            ip: pickText(c.affectedMachine?.ip, c.ip, alertPrimaryIp(alerts?.[0])),
            hostname: pickText(c.affectedMachine?.hostname, (Array.isArray(alerts) ? alerts : []).find((alert) => alert?.hostname)?.hostname),
            user: pickText(c.affectedMachine?.user, (Array.isArray(alerts) ? alerts : []).find((alert) => alert?.user)?.user),
        },
    };
}

export function getCases() {
    const list = readJson(LS_CASES, null);
    if (!Array.isArray(list)) {
        writeJson(LS_CASES, []);
        return [];
    }

    const normalized = list
        .map((x) => {
            if (!x) return null;
            try {
                return normalizeCase(x);
            } catch (e) {
                console.error(e);
                return null;
            }
        })
        .filter((c) => c && c.incidentId);

    // Deduplicate: keep only latest case per incidentId
    const seen = new Map();
    for (const c of normalized) {
        const existing = seen.get(c.incidentId);
        if (!existing || new Date(c.createdAt) > new Date(existing.createdAt)) {
            seen.set(c.incidentId, c);
        }
    }

    const deduplicated = Array.from(seen.values());

    // If deduplication removed cases, persist the cleaned list
    if (deduplicated.length < normalized.length) {
        writeJson(LS_CASES, deduplicated);
    }

    return deduplicated;
}

export function setCases(next) {
    const normalized = (Array.isArray(next) ? next : [])
        .map((x) => {
            if (!x) return null;
            try {
                return normalizeCase(x);
            } catch (e) {
                console.error(e);
                return null;
            }
        })
        .filter(Boolean);
    writeJson(LS_CASES, normalized);
    emitPlatformDataChanged();
}

export function upsertCase(caseItem) {
    const candidate = normalizeCase(caseItem);
    const existing = getCases();
    const matchIndex = existing.findIndex((row) => row.id === candidate.id || (row.incidentId && row.incidentId === candidate.incidentId));
    if (matchIndex >= 0) {
        const next = [...existing];
        next[matchIndex] = normalizeCase({ ...existing[matchIndex], ...candidate });
        setCases(next);
        return next;
    }
    const next = [...existing, candidate];
    setCases(next);
    return next;
}

export function syncIncidentStatusWithCase(caseId) {
    try {
        const cases = getCases();
        const targetCase = cases.find((c) => c.id === caseId);
        if (!targetCase || !targetCase.incidentId) return;

        const incidents = getIncidents();
        const targetIncident = incidents.find((i) => i.id === targetCase.incidentId);
        if (!targetIncident) return;

        // If case is closed, update incident to closed with full sync
        if (String(targetCase.status || "").toLowerCase() === "closed") {
            const updated = {
                ...targetIncident,
                status: "closed",
                resolvedAt: new Date().toISOString(),
                closedAt: new Date().toISOString(),
                reviewStatus: "completed",
                resolution: targetIncident.classification || "resolved",
            };
            upsertIncident(updated);
            logAction("resolve_incident", { incidentId: targetIncident.id, caseId: caseId, message: `Incident resolved (case closed)` });
        }
    } catch (error) {
        console.error("Error syncing incident status with case:", error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED SYNCHRONIZATION LAYER - Single Source of Truth
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unified action handler that synchronizes across all entities.
 * This is the ONLY place where state changes should originate.
 */
export function executeUnifiedAction(action, payload = {}) {
    const now = new Date().toISOString();
    const analyst = payload.analyst || getCurrentUser()?.name || "System";

    try {
        switch (action) {
            case "classify_incident": {
                const { incidentId, classification, comment } = payload;
                
                apiClassifyIncident(incidentId, classification, "closed")
                    .then(() => syncWithBackend())
                    .catch((err) => console.error("Real classifyIncident failed:", err));

                const incidents = getIncidents();
                const incident = incidents.find((i) => i.id === incidentId);
                if (!incident) return null;

                // Update incident
                const updatedIncident = {
                    ...incident,
                    status: "closed",
                    closedAt: now,
                    classification,
                    resolvedBy: analyst,
                    resolvedAt: now,
                    reviewStatus: "completed",
                    resolution: classification === "false_positive" ? "false_positive" : classification === "duplicate" ? "duplicate" : "resolved",
                };
                upsertIncident(updatedIncident);

                // Update related alerts
                const alertIds = incident.alertIds || [];
                alertIds.forEach((alertId) => {
                    updateStoredAlert(alertId, (current) => ({
                        ...current,
                        status: "resolved",
                        falsePositive: classification === "false_positive",
                        incidentId,
                    }));
                });

                // Update linked case if exists
                const cases = getCases();
                const linkedCase = cases.find((c) => c.incidentId === incidentId);
                if (linkedCase) {
                    const caseResolution = classification === "false_positive" ? "false_positive" : classification === "duplicate" ? "duplicate" : "true_positive";
                    const updatedCase = {
                        ...linkedCase,
                        status: "closed",
                        resolution: caseResolution,
                        closedAt: now,
                        closedBy: analyst,
                        archived: caseResolution === "false_positive",
                    };
                    upsertCase(updatedCase);
                }

                // Create audit log
                pushAudit({
                    action: "classification",
                    entityType: "incident",
                    entityId: incidentId,
                    classification,
                    analyst,
                    message: `Incident classified as ${classification}`,
                    comment: comment || "",
                    timestamp: now,
                });

                // Create notification
                pushNotification(`Incident ${incidentId} classified as ${classification}`, { category: "incident" });

                emitPlatformDataChanged();
                return updatedIncident;
            }

            case "close_case": {
                const { caseId, classification, comment } = payload;

                apiCloseCase(caseId, { classification, comment })
                    .then(() => syncWithBackend())
                    .catch((err) => console.error("Real closeCase failed:", err));

                const cases = getCases();
                const caseItem = cases.find((c) => c.id === caseId);
                if (!caseItem) return null;

                // Update case
                const updatedCase = {
                    ...caseItem,
                    status: "closed",
                    resolution: classification,
                    closedAt: now,
                    closedBy: analyst,
                    archived: classification === "false_positive",
                };
                upsertCase(updatedCase);

                // Sync incident if linked
                if (caseItem.incidentId) {
                    const incidents = getIncidents();
                    const incident = incidents.find((i) => i.id === caseItem.incidentId);
                    if (incident) {
                        const updatedIncident = {
                            ...incident,
                            status: "closed",
                            closedAt: now,
                            classification,
                            resolvedBy: analyst,
                            resolvedAt: now,
                            reviewStatus: "completed",
                            resolution: classification === "false_positive" ? "false_positive" : classification === "duplicate" ? "duplicate" : "resolved",
                        };
                        upsertIncident(updatedIncident);

                        // Update related alerts
                        const alertIds = incident.alertIds || [];
                        alertIds.forEach((alertId) => {
                            updateStoredAlert(alertId, (current) => ({
                                ...current,
                                status: "resolved",
                                falsePositive: classification === "false_positive",
                                incidentId: incident.id,
                            }));
                        });
                    }
                }

                // Create audit log
                pushAudit({
                    action: "close_case",
                    entityType: "case",
                    entityId: caseId,
                    classification,
                    analyst,
                    message: `Case closed - ${classification}`,
                    comment: comment || "",
                    timestamp: now,
                });

                pushNotification(`Case ${caseId} closed - ${classification}`, { category: "case" });
                emitPlatformDataChanged();
                return updatedCase;
            }

            case "assign_case": {
                const { caseId, assignedTo } = payload;

                apiAssignCase(caseId, assignedTo)
                    .then(() => syncWithBackend())
                    .catch((err) => console.error("Real assignCase failed:", err));

                const cases = getCases();
                const caseItem = cases.find((c) => c.id === caseId);
                if (!caseItem) return null;

                const normalizedAssignedTo = String(assignedTo || "").replace(/\s*\(You\)\s*$/i, "").trim();

                const updatedCase = {
                    ...caseItem,
                    assignedTo: normalizedAssignedTo,
                    updatedAt: now,
                };
                upsertCase(updatedCase);

                if (caseItem.incidentId) {
                    updateIncidentStatusOnAssign(caseItem.incidentId, normalizedAssignedTo);

                    // Update corresponding incident owner/assignedTo directly in storage
                    const incidents = getIncidents();
                    const updatedIncidents = incidents.map((i) => {
                        if (String(i.id) === String(caseItem.incidentId)) {
                            return {
                                ...i,
                                owner: normalizedAssignedTo,
                                assignedTo: normalizedAssignedTo,
                            };
                        }
                        return i;
                    });
                    setIncidents(updatedIncidents);

                    // Update all linked alerts
                    const incident = incidents.find((i) => String(i.id) === String(caseItem.incidentId));
                    if (incident && Array.isArray(incident.alertIds)) {
                        incident.alertIds.forEach((alertId) => {
                            updateStoredAlert(alertId, (current) => ({
                                ...current,
                                assignedTo: normalizedAssignedTo,
                            }));
                        });
                    }
                }

                pushAudit({
                    action: "assign_case",
                    entityType: "case",
                    entityId: caseId,
                    assignedTo: normalizedAssignedTo,
                    analyst,
                    message: `Case assigned to ${normalizedAssignedTo}`,
                    timestamp: now,
                });

                pushNotification(`Case ${caseId} assigned to ${normalizedAssignedTo}`, { category: "case" });
                emitPlatformDataChanged();
                return updatedCase;
            }

            case "escalate_case": {
                const { caseId, level, assignee, reason } = payload;

                apiEscalateCase(caseId, { level, assignee, reason })
                    .then(() => syncWithBackend())
                    .catch((err) => console.error("Real escalateCase failed:", err));

                const cases = getCases();
                const caseItem = cases.find((c) => c.id === caseId);
                if (!caseItem) return null;

                const updatedCase = {
                    ...caseItem,
                    escalatedTo: level,
                    escalationReason: reason,
                    escalated: true,
                    status: "escalated",
                    pending: true,
                    assignedTo: assignee || level,
                    updatedAt: now,
                };
                upsertCase(updatedCase);

                pushAudit({
                    action: "escalate_case",
                    entityType: "case",
                    entityId: caseId,
                    level,
                    reason,
                    analyst,
                    message: `Case escalated to ${level}`,
                    timestamp: now,
                });

                pushNotification(`Case ${caseId} escalated to ${level}`, { category: "case" });
                emitPlatformDataChanged();
                return updatedCase;
            }

            case "archive_case": {
                const { caseId } = payload;
                const cases = getCases();
                const caseItem = cases.find((c) => c.id === caseId);
                if (!caseItem) return null;

                const updatedCase = {
                    ...caseItem,
                    archived: true,
                    updatedAt: now,
                };
                upsertCase(updatedCase);

                pushAudit({
                    action: "archive_case",
                    entityType: "case",
                    entityId: caseId,
                    analyst,
                    message: `Case archived`,
                    timestamp: now,
                });

                pushNotification(`Case ${caseId} archived`, { category: "case" });
                emitPlatformDataChanged();
                return updatedCase;
            }

            default:
                console.warn(`Unknown unified action: ${action}`);
                return null;
        }
    } catch (error) {
        console.error(`Error executing unified action ${action}:`, error);
        return null;
    }
}

/**
 * Calculate metrics directly from authoritative store data.
 * NO hardcoded values, NO placeholders.
 */
export function calculateMetrics() {
    const incidents = getIncidents();
    const cases = getCases();
    const auditLogs = getAuditLog();

    // False Positive Rate
    const resolvedCases = cases.filter((c) => c.status === "closed");
    const falsePositiveCases = resolvedCases.filter((c) => c.resolution === "false_positive");
    const falsePositiveRate = resolvedCases.length > 0
        ? Math.round((falsePositiveCases.length / resolvedCases.length) * 100)
        : 0;

    // Detection Efficacy (True Positive Rate)
    const investigatedCases = cases.filter((c) => c.status === "closed" || c.status === "triage");
    const truePositiveCases = resolvedCases.filter((c) => c.resolution === "true_positive" || c.resolution === "resolved");
    const detectionEfficacy = investigatedCases.length > 0
        ? Math.round((truePositiveCases.length / investigatedCases.length) * 100)
        : 0;

    // MTTR (Mean Time To Resolution)
    const resolvedIncidents = incidents.filter((i) => i.closedAt && i.createdAt);
    let mttr = 0;
    if (resolvedIncidents.length > 0) {
        const totalMs = resolvedIncidents.reduce((acc, i) => {
            return acc + (new Date(i.closedAt).getTime() - new Date(i.createdAt).getTime());
        }, 0);
        mttr = Math.round(totalMs / resolvedIncidents.length / 1000); // seconds
    }

    // Analyst Workload
    const analystActions = {};
    auditLogs.forEach((log) => {
        const analyst = log.analyst || "Unknown";
        analystActions[analyst] = (analystActions[analyst] || 0) + 1;
    });

    // Open Cases
    const openCases = cases.filter((c) => c.status !== "closed" && !c.archived);

    // Pending Review
    const pendingReview = cases.filter((c) => c.status === "triage" && !c.archived);

    // Archived Cases
    const archivedCases = cases.filter((c) => c.archived);

    return {
        falsePositiveRate,
        detectionEfficacy,
        mttr,
        analystActions,
        openCases: openCases.length,
        pendingReview: pendingReview.length,
        archivedCases: archivedCases.length,
        totalCases: cases.length,
        totalIncidents: incidents.length,
        resolvedIncidents: resolvedIncidents.length,
        resolvedCases: resolvedCases.length,
    };
}

function deriveMitreFromAlerts(alerts) {
    const mitreMap = {
        "ssh": { id: "T1110", name: "Brute Force", tactic: "Credential Access" },
        "brute": { id: "T1110", name: "Brute Force", tactic: "Credential Access" },
        "process": { id: "T1059", name: "Command and Scripting Interpreter", tactic: "Execution" },
        "powershell": { id: "T1059", name: "Command and Scripting Interpreter", tactic: "Execution" },
        "traffic": { id: "T1071", name: "Application Layer Protocol", tactic: "Command and Control" },
        "dns": { id: "T1071", name: "Application Layer Protocol", tactic: "Command and Control" },
        "network": { id: "T1071", name: "Application Layer Protocol", tactic: "Command and Control" },
        "c2": { id: "T1071", name: "Application Layer Protocol", tactic: "Command and Control" },
        "lateral": { id: "T1021", name: "Remote Services", tactic: "Lateral Movement" },
        "scan": { id: "T1046", name: "Network Service Discovery", tactic: "Discovery" }
    };

    const result = new Map();
    (Array.isArray(alerts) ? alerts : []).forEach(a => {
        const text = `${a.ruleDescription || a.desc || ""} ${a.sub || ""}`.toLowerCase();
        Object.keys(mitreMap).forEach(k => {
            if (text.includes(k)) {
                const mitre = mitreMap[k];
                result.set(mitre.id, mitre);
            }
        });
    });
    return Array.from(result.values());
}

export async function createCaseFromIncident(incident) {
    const inc = incident && typeof incident === "object" ? incident : {};
    const incidentId = pickText(inc.id);
    if (!incidentId) return null;

    const cases = getCases();
    const exists = cases.find((c) => c.incidentId === incidentId);
    if (exists) return exists;

    const isLive = typeof window !== "undefined" && !!(localStorage.getItem("auth_token") || localStorage.getItem("isAuthToken"));

    if (isLive) {
        try {
            console.log("Creating case for incident via API:", incidentId);
            await apiCreateCase({ incident_id: incidentId });
            await syncWithBackend();
            const freshCases = getCases();
            const freshExists = freshCases.find((c) => c.incidentId === incidentId);
            if (freshExists) {
                console.log("Successfully created and synced case from backend:", freshExists.id);
                return freshExists;
            }
            throw new Error("Case created on backend, but could not be located in local synced store.");
        } catch (err) {
            console.error("Real apiCreateCase failed under Live Mode:", err);
            throw err;
        }
    }

    try {
        console.log("Creating case for incident offline/mock:", incidentId);
    } catch (err) {
        console.error("apiCreateCase offline logging failed:", err);
    }

    // Build full MITRE structure with details
    let mitreList = [];
    if (Array.isArray(inc.mitreTechniques) && inc.mitreTechniques.length) {
        mitreList = inc.mitreTechniques.map((t) => {
            if (typeof t === "object") return t;
            return { id: String(t).trim(), name: getMitreName(String(t).trim()), tactic: getMitreTactic(String(t).trim()) };
        }).filter(t => t.id);
    } else if (Array.isArray(inc.mitre) && inc.mitre.length) {
        mitreList = inc.mitre.map(t => {
            if (typeof t === "object") return t;
            return { id: String(t).trim(), name: getMitreName(String(t).trim()), tactic: getMitreTactic(String(t).trim()) };
        });
    } else {
        mitreList = deriveMitreFromAlerts(inc.alerts || []);
    }
    mitreList = uniq(mitreList.map(t => t.id)).slice(0, 5).map(id => {
        const existing = mitreList.find(m => m.id === id);
        return existing || { id, name: getMitreName(id), tactic: getMitreTactic(id) };
    });

    const now = new Date().toISOString();
    const analyst = getCurrentUser()?.name || "SOC Analyst";

    // Build enterprise audit log
    const auditLog = [
        {
            id: `audit-${Date.now()}-1`,
            type: "primary",
            title: "Case Created",
            analyst,
            at: now,
            message: `Case created from incident ${incidentId}`,
            severity: "info"
        },
        {
            id: `audit-${Date.now()}-2`,
            type: "secondary",
            title: "Incident Linked",
            analyst: "System",
            at: new Date(Date.parse(now) + 1000).toISOString(),
            message: `Linked to incident ${incidentId}`,
            severity: "info"
        }
    ];

    const newCase = {
        id: `CR-${Date.now()}`,
        incidentId,
        linkedIncident: inc,

        title: pickText(inc.type, `Case ${incidentId}`),
        description: `Escalated from incident ${incidentId}`,

        severity: normalizeSeverity(inc.severity),
        severityLabel: String(normalizeSeverity(inc.severity)).charAt(0).toUpperCase() + String(normalizeSeverity(inc.severity)).slice(1),

        status: "triage",
        classification: "",
        resolution: "",

        assignedTo: (inc.assignedTo || inc.owner || analyst || "").replace(/\s*\(You\)\s*$/i, "").trim(),
        openedBy: (analyst || "").replace(/\s*\(You\)\s*$/i, "").trim(),

        createdAt: now,
        updatedAt: now,

        alertIds: Array.isArray(inc.alertIds) ? inc.alertIds : [],
        linkedAlerts: Array.isArray(inc.alerts) ? inc.alerts : [],
        alerts: Array.isArray(inc.alerts) ? inc.alerts : [],

        mitre: mitreList,
        confidence: Number.isFinite(Number(inc.confidence)) ? inc.confidence : 85,
        correlationScore: Number.isFinite(Number(inc.correlationScore)) ? inc.correlationScore : 78,

        affectedMachine: inc.affectedMachine && typeof inc.affectedMachine === "object" ? inc.affectedMachine : {
            hostname: pickText(inc.hostname, "target-host"),
            ip: pickText(inc.ip, "192.168.1.0")
        },
        targetAssets: [
            pickText(inc.hostname, "target-host"),
            pickText(inc.ip, "192.168.1.0")
        ],

        escalationLevel: "",

        auditLog,

        notes: [],

        timeline: [
            {
                id: 1,
                type: "primary",
                title: "Automated Containment",
                at: new Date(Date.parse(now) - 18 * 60 * 1000).toISOString(),
                text: `System isolated endpoint ${pickText(inc.hostname, "target-host")} after suspicious activity.`
            },
            {
                id: 2,
                type: "secondary",
                title: "Analyst Assigned",
                at: new Date(Date.parse(now) - 9 * 60 * 1000).toISOString(),
                text: `Lead analyst ${analyst} took ownership of the case.`
            },
            {
                id: 3,
                type: "secondary",
                title: "Incident Linked",
                at: new Date(Date.parse(now) - 3 * 60 * 1000).toISOString(),
                text: `Alert IDs ${(inc.alertIds || []).slice(0, 2).join(", ") || incidentId} correlated into this case.`
            },
            {
                id: 4,
                type: "secondary",
                title: "Priority Escalated",
                at: new Date(Date.parse(now) - 1 * 60 * 1000).toISOString(),
                text: `Status changed to ${String(normalizeSeverity(inc.severity)).toUpperCase()} by correlation engine.`
            }
        ],

        attackStages: inc.stages || ["Initial Access", "Execution", "Persistence"],

        sourceBreakdown: {
            "Network ML": 1,
            "Wazuh": 1,
            "EDR": 0
        },

        archived: false,
        pending: true,
        createdManually: false,
        isMine: true,
        priority: normalizeSeverity(inc.severity),
        dot: normalizeSeverity(inc.severity) === "critical" ? "red" : normalizeSeverity(inc.severity) === "high" ? "yellow" : "green"
    };

    const updated = [...cases, newCase];
    setCases(updated);

    // Link incident to case
    const incidents = getIncidents();
    const incidentIdx = incidents.findIndex(i => i.id === incidentId);
    if (incidentIdx >= 0) {
        incidents[incidentIdx].caseId = newCase.id;
        incidents[incidentIdx].linkedCase = newCase;
        writeJson(LS_INCIDENTS, incidents);
    }

    emitPlatformDataChanged();
    return getCases().find((c) => c.incidentId === incidentId) || null;
}

function getMitreName(id) {
    const names = {
        "T1059": "Command and Scripting Interpreter",
        "T1021": "Remote Services",
        "T1041": "Exfiltration Over C2 Channel",
        "T1071": "Application Layer Protocol",
        "T1110": "Brute Force",
        "T1046": "Network Service Discovery",
        "T1005": "Data from Local System",
        "T1078": "Valid Accounts"
    };
    return names[id] || "Technique";
}

function getMitreTactic(id) {
    const tactics = {
        "T1059": "Execution",
        "T1021": "Lateral Movement",
        "T1041": "Exfiltration",
        "T1071": "Command and Control",
        "T1110": "Credential Access",
        "T1046": "Discovery",
        "T1005": "Collection",
        "T1078": "Defense Evasion"
    };
    return tactics[id] || "Tactic";
}

export function getAuditLog() {
    return Array.isArray(backendAuditLogCache) ? backendAuditLogCache : [];
}

export function pushAudit(entry) {
    const row = { id: `a-${Date.now()}`, at: new Date().toISOString(), ...entry };
    backendAuditLogCache = [row, ...getAuditLog()];
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("soc_audit_update"));
    }
    return row;
}

export function logAction(action, details = {}) {
    try {
        const user = getCurrentUser();
        const analyst = user?.name || "System";
        const role = user?.roleType || "analyst";

        return pushAudit({
            action,
            analyst,
            role,
            details: typeof details === "string" ? details : JSON.stringify(details),
            ...details,
        });
    } catch (e) {
        console.error("Error logging action:", e);
        return null;
    }
}

export function getIncidentAuditLogs() {
    const list = readJson(LS_INCIDENT_AUDIT, []);
    return Array.isArray(list) ? list : [];
}

export function addIncidentAuditLog(log) {
    try {
        if (!log || typeof log !== "object") {
            console.warn("Invalid audit log entry:", log);
            return null;
        }

        const entry = {
            id: `ial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            at: new Date().toISOString(),
            type: log.type || "UNKNOWN",
            incidentId: log.incidentId || null,
            ...log,
        };

        if (!entry.incidentId) {
            console.warn("Audit log missing incidentId:", entry);
            return null;
        }

        const next = [entry, ...getIncidentAuditLogs()];
        writeJson(LS_INCIDENT_AUDIT, next);

        if (typeof window !== "undefined") {
            try {
                window.dispatchEvent(new Event("soc_platform_data"));
            } catch (dispatchError) {
                console.error("Error dispatching platform data event:", dispatchError);
            }
        }
        return entry;
    } catch (error) {
        console.error("Error adding incident audit log:", error);
        return null;
    }
}

export function getIncidentAuditLogsByIncidentId(incidentId) {
    try {
        const logs = getIncidentAuditLogs();
        const safeIncidentId = incidentId || null;
        if (!safeIncidentId) return [];
        const filtered = logs.filter((log) => log && log.incidentId === safeIncidentId);
        return filtered.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
    } catch (error) {
        console.error("Error getting incident audit logs:", error);
        return [];
    }
}

export function getNotifications() {
    return Array.isArray(backendNotificationsCache) && backendNotificationsCache.length ? backendNotificationsCache : NOTIF_SEED;
}

export function setNotifications(list) {
    backendNotificationsCache = Array.isArray(list) ? list : [];
    emitNotifications(getNotifications());
}

export function pushNotification(text, meta = {}) {
    const row = {
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text,
        read: false,
        at: Date.now(),
        ...meta,
        category: meta.category || inferNotificationCategory(text, meta),
    };
    const next = [row, ...getNotifications()];
    backendNotificationsCache = next;
    emitNotifications(next);
    return row;
}

export function correlateAlerts(alerts) {
    return generateIncidents(alerts);
}

function mapStage(alert) {
    if (alert?.source === "Wazuh") return "Initial Access";
    if (alert?.source === "Suricata") return "Recon / Scan";
    if (alert?.source === "Sysmon") return "Execution";
    if (alert?.source === "Network ML") return "C2 / Exfiltration";
    return "Unknown";
}

function parseAlertTimestamp(alert) {
    const created = Date.parse(alert?.createdAt || "");
    if (Number.isFinite(created)) return created;
    const fallback = alert?.date && alert?.time ? Date.parse(`${alert.date}T${alert.time}`) : NaN;
    return Number.isFinite(fallback) ? fallback : 0;
}

export function buildTimeline(alerts) {
    return (Array.isArray(alerts) ? alerts : []).map((a) => ({
        id: a.id,
        title: a.desc,
        time: a.time,
        stage: mapStage(a),
        source: a.source,
        severity: a.severity,
    }));
}

export function generateIncidents(alerts) {
    try {
        const normalized = [...(Array.isArray(alerts) ? alerts : [])];
        const groups = {};

        console.log("ALERT IPS:", normalized.map((a) => a?.srcIP));

        normalized.forEach((a) => {
            const key =
                a.srcIP ||
                a.srcip ||
                a.src_ip ||
                a.data?.srcip ||
                a.data?.src_ip ||
                a.sourceIP;

            if (!key) return;

            if (!groups[key]) groups[key] = { ip: key, alerts: [] };
            groups[key].alerts.push(a);
        });

        console.log("GROUPED INCIDENTS:", groups);

        return Object.entries(groups).map(([key, group]) => {
            const sorted = [...group.alerts].sort(
                (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
            );
            const ip = group.ip;
            console.log("GROUP:", ip, sorted.length, sorted.map(a => a.severity));

            const hasCritical = sorted.some((a) => a.severity === "critical");
            const hasHigh = sorted.some((a) => a.severity === "high");
            const severity = hasCritical ? "critical" : hasHigh ? "high" : "medium";
            const sources = [...new Set(sorted.map((a) => a.source))];
            const stages = [...new Set(sorted.map((a) => mapStage(a)))];
            const severityWeight = {
                critical: 40,
                high: 25,
                medium: 15,
                low: 5,
            };

            let baseScore = sorted.reduce((sum, a) => {
                return sum + (severityWeight[a.severity] || 5);
            }, 0);

            const sourceBonus = new Set(sorted.map((a) => a.source)).size * 5;
            const alertBonus = sorted.length * 3;

            let riskScore = baseScore + sourceBonus + alertBonus;

            riskScore = Math.min(riskScore, 100);

            if (hasCritical) {
                riskScore = Math.max(riskScore, 92);
            } else {
                riskScore = Math.min(riskScore, 85);
            }

            const status = "open";
            const correlationScore = riskScore;
            const reviewStatus = "review";
            console.log("FINAL SCORE:", ip, riskScore);

            return {
                id: `INC-${stableHash(key)}`,
                ip,
                sourceIP: ip,
                severity,
                alerts: sorted,
                alertIds: sorted.map((a) => a.id),
                sources,
                stages,
                timeline: buildTimeline(sorted),
                correlationScore,
                riskScore: riskScore,
                reviewStatus,
                createdAt: sorted[0]?.createdAt || new Date().toISOString(),
                status,
                autoEscalated: false,
                escalated: false,
                classification: null,
                caseId: null,
            };
        });
    } catch (e) {
        console.error(e);
        return [];
    }
}

if (typeof window !== "undefined") {
    window.forceRegen = () => {
        const alerts = JSON.parse(localStorage.getItem("soc_alerts") || "[]");
        const incidents = correlateAlerts(alerts);
        localStorage.setItem("soc_incidents", JSON.stringify(incidents));
        window.dispatchEvent(new Event("soc_platform_data"));
        console.log("REGENERATED");
    };

    window.resetToDemo = () => {
        console.log("🔄 RESETTING SYSTEM TO DEMO MODE...");

        // 1. Reset all incidents to OPEN with proper auto-escalation flags
        const incidents = getIncidents();
        const resetIncidents = incidents.map(i => {
            const score = i.correlationScore || 0;
            const severity = String(i.severity || "").toLowerCase();
            const shouldAutoEscalate = score >= 90 || severity === "critical";

            return {
                ...i,
                status: "open",
                caseId: null,
                autoEscalated: shouldAutoEscalate,
                escalatedByUser: false,
                classification: shouldAutoEscalate ? "Pending Review" : null,
                closedAt: "",
                escalated: shouldAutoEscalate,
            };
        });
        setIncidents(resetIncidents);
        console.log("✔ Incidents reset to OPEN with auto-escalation flags");

        // 2. Reset all cases to TRIAGE
        const cases = getCases();
        const resetCases = cases.map(c => ({
            ...c,
            status: "open",
            phase: "Triage",
            closedAt: "",
            archived: false,
        }));
        setCases(resetCases);
        console.log("✔ Cases reset to TRIAGE/OPEN");

        // 3. Reset all alerts to OPEN/ACTIVE
        const alerts = getAlerts();
        const resetAlerts = alerts.map(a => ({
            ...a,
            status: "open",
            resolved: false,
        }));
        setAlerts(resetAlerts);
        console.log("✔ Alerts reset to OPEN");

        // 4. Clear audit logs
        localStorage.removeItem(LS_AUDIT);
        localStorage.removeItem(LS_INCIDENT_AUDIT);
        console.log("✔ Audit logs cleared");

        // 5. Clear notifications
        localStorage.removeItem(LS_NOTIFS);
        console.log("✔ Notifications cleared");

        // 6. Trigger re-render
        window.dispatchEvent(new Event("soc_platform_data"));
        console.log("✅ DEMO MODE READY - All incidents OPEN, cases TRIAGE, auto-escalation enabled for critical");
    };

    window.syncIncidentCaseData = () => {
        console.log("🔄 SYNCING INCIDENT/CASE DATA...");

        // 1. Get all incidents and cases
        const incidents = getIncidents();
        const cases = getCases();

        // 2. For each critical incident, ensure it has a linked case
        const syncedIncidents = incidents.map(inc => {
            const score = inc.correlationScore || 0;
            const severity = String(inc.severity || "").toLowerCase();
            const isCritical = score >= 90 || severity === "critical";

            if (isCritical && !inc.caseId) {
                // Create a case for this critical incident
                const newCase = {
                    id: `CR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    incidentId: inc.id,
                    severity: inc.severity,
                    status: "open",
                    phase: "Triage",
                    closedAt: "",
                    pending: true,
                    createdAt: new Date().toISOString(),
                    alerts: inc.alerts || [],
                    mitre: inc.mitre || [],
                    title: inc.type || `Case for ${inc.id}`,
                    description: `Auto-escalated from incident ${inc.id}`,
                    ip: inc.ip,
                    affectedMachine: inc.affectedMachine || {},
                    alertIds: inc.alertIds || [],
                    confidence: inc.confidence || null,
                    archived: false,
                    createdManually: false,
                };

                // Add case to store
                const updatedCases = [...cases, newCase];
                setCases(updatedCases);
                console.log("✔ Created case:", newCase.id, "for incident:", inc.id);

                // Link incident to case
                return {
                    ...inc,
                    caseId: newCase.id,
                    autoEscalated: true,
                    escalated: true,
                    classification: "Pending Review",
                    status: "open",
                };
            }

            return inc;
        });

        // 3. Ensure all cases have correct status
        const syncedCases = cases.map(c => ({
            ...c,
            status: String(c.status || "").toLowerCase() === "closed" ? "closed" : "open",
            phase: String(c.phase || "").toLowerCase() === "closed" ? "Closed" : "Triage",
        }));

        // 4. Update stores
        setIncidents(syncedIncidents);
        setCases(syncedCases);

        // 5. Trigger re-render
        window.dispatchEvent(new Event("soc_platform_data"));
        console.log("✅ SYNC COMPLETE - Incidents linked to cases, all statuses synchronized");
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // AUTHORITATIVE STATE INITIALIZATION - Force correct state on app start
    // ═══════════════════════════════════════════════════════════════════════════════
    window.initializeAuthoritativeState = () => {
        console.log("🔐 INITIALIZING AUTHORITATIVE STATE...");

        // 1. Get current state
        const incidents = getIncidents();
        const cases = getCases();
        const alerts = getAlerts();

        // 2. Force all alerts to OPEN
        const fixedAlerts = alerts.map(a => ({
            ...a,
            status: "open",
            resolved: false,
        }));
        setAlerts(fixedAlerts);
        console.log("✔ All alerts set to OPEN");

        // 3. Force critical incidents to auto-escalate with cases
        const fixedIncidents = incidents.map(inc => {
            const score = inc.correlationScore || 0;
            const severity = String(inc.severity || "").toLowerCase();
            const isCritical = score >= 90 || severity === "critical";

            if (isCritical) {
                // Ensure critical incident has a case
                let caseId = inc.caseId;
                if (!caseId) {
                    const newCase = {
                        id: `CR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        incidentId: inc.id,
                        severity: inc.severity,
                        status: "open",
                        phase: "Triage",
                        closedAt: "",
                        pending: true,
                        createdAt: new Date().toISOString(),
                        alerts: inc.alerts || [],
                        mitre: inc.mitre || [],
                        title: inc.type || `Case for ${inc.id}`,
                        description: `Auto-escalated from incident ${inc.id}`,
                        ip: inc.ip,
                        affectedMachine: inc.affectedMachine || {},
                        alertIds: inc.alertIds || [],
                        confidence: inc.confidence || null,
                        archived: false,
                        createdManually: false,
                    };
                    cases.push(newCase);
                    caseId = newCase.id;
                    console.log("✔ Created case:", caseId, "for critical incident:", inc.id);
                }

                return {
                    ...inc,
                    status: "open",
                    caseId,
                    autoEscalated: true,
                    escalated: true,
                    classification: "Pending Review",
                };
            }

            // Non-critical incidents remain open
            return {
                ...inc,
                status: "open",
                autoEscalated: false,
                escalated: false,
            };
        });

        // 4. Force all cases to OPEN/TRIAGE
        const fixedCases = cases.map(c => ({
            ...c,
            status: "open",
            phase: "Triage",
            closedAt: "",
            archived: false,
        }));

        // 5. Update all stores
        setAlerts(fixedAlerts);
        setIncidents(fixedIncidents);
        setCases(fixedCases);

        // 6. Trigger re-render
        window.dispatchEvent(new Event("soc_platform_data"));
        console.log("✅ AUTHORITATIVE STATE INITIALIZED - All data synchronized");
    };
}

export async function syncWithBackend() {
    if (typeof window === "undefined") return;

    const token = localStorage.getItem("auth_token") || sessionStorage.getItem("auth_token") || localStorage.getItem("isAuthToken");
    if (!token) {
        console.log("🔄 SentinelX: No auth token found. Skipping sync.");
        return;
    }

    const curUserRaw = localStorage.getItem("currentUser");
    let userRole = "analyst";
    if (curUserRaw) {
        try {
            const u = JSON.parse(curUserRaw);
            userRole = (u.roleType || "analyst").toLowerCase();
        } catch {}
    }

    try {
        console.log(`🔄 SentinelX: Syncing with real Laravel backend (Role: ${userRole})...`);
        
        let rawAlerts = [];
        let rawIncidents = [];
        let rawCases = [];

        // 1. Fetch alerts: accessible to admin and analyst
        if (userRole === "admin" || userRole === "analyst") {
            try {
                const alertsRes = await getAlertsList({ per_page: 200 });
                rawAlerts = alertsRes?.data || alertsRes || [];
            } catch (e) {
                console.warn("Failed to fetch alerts:", e);
            }
        }
        
        // 2. Fetch incidents: accessible to all roles
        try {
            const incidentsRes = await getIncidentsList({ per_page: 100 });
            rawIncidents = incidentsRes?.data || incidentsRes || [];
        } catch (e) {
            console.warn("Failed to fetch incidents:", e);
        }
        
        // 3. Fetch cases: accessible to admin and analyst
        if (userRole === "admin" || userRole === "analyst") {
            try {
                const casesRes = await getCasesList({ per_page: 100 });
                rawCases = casesRes?.data || casesRes || [];
            } catch (e) {
                console.warn("Failed to fetch cases:", e);
            }
        }

        await syncOperationalData(userRole);

        // ═══════════════════════════════════════════════════════════════════════════════
        // DYNAMIC DEDICATED MITRE CACHE INTEGRATION
        // ═══════════════════════════════════════════════════════════════════════════════
        const LS_MITRE_CACHE = "soc_mitre_cache";
        const mitreCache = readJson(LS_MITRE_CACHE, {});
        let cacheUpdated = false;
        
        const rawAlertsArray = Array.isArray(rawAlerts) ? rawAlerts : [];
        const newAlertsToFetch = rawAlertsArray.filter(a => a.id && !mitreCache[a.id]);
        
        if (newAlertsToFetch.length > 0 && (userRole === "admin" || userRole === "analyst")) {
            console.log(`🔍 SentinelX: Fetching dynamic MITRE mappings for ${newAlertsToFetch.length} new alerts...`);
            const mitrePromises = newAlertsToFetch.map(async (a) => {
                try {
                    const mRes = await getMitreMapping(a.id);
                    const mappingData = mRes?.mapping || mRes?.data?.mapping || mRes;
                    if (mappingData && mappingData.technique_id) {
                        return { id: a.id, mapping: mappingData };
                    }
                } catch (e) {
                    console.warn(`Could not fetch MITRE mapping for alert ${a.id}:`, e);
                }
                return { id: a.id, mapping: null };
            });
            
            const results = await Promise.all(mitrePromises);
            results.forEach(r => {
                if (r.mapping) {
                    mitreCache[r.id] = r.mapping;
                    cacheUpdated = true;
                }
            });
            
            if (cacheUpdated) {
                writeJson(LS_MITRE_CACHE, mitreCache);
            }
        }

        // Save raw alerts/incidents/cases to localStorage in format expected by frontend
        if (rawAlertsArray.length > 0) {
            const formattedAlerts = rawAlertsArray.map(a => {
                const dynamicMitre = mitreCache[a.id];
                return {
                    ...a,
                    id: a.id ? String(a.id) : `ALT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    srcIP: a.src_ip || a.srcip || "0.0.0.0",
                    dstIP: a.dest_ip || a.destip || "0.0.0.0",
                    desc: a.description || a.desc || "Security Event Alert",
                    createdAt: a.alerted_at || a.created_at || a.createdAt || new Date().toISOString(),
                    assignedTo: a.assigned_to || a.assignedTo || null,
                    incidentId: a.incident_id || a.incidentId || null,
                    correlationId: a.correlation_id || a.correlationId || null,
                    status: a.status || "new",
                    severity: a.severity || "medium",
                    mitre: dynamicMitre ? {
                        id: dynamicMitre.technique_id,
                        name: dynamicMitre.technique,
                        tactic: dynamicMitre.tactic
                    } : null
                };
            });
            
            writeJson(LS_ALERTS, formattedAlerts);
        }

        if (Array.isArray(rawIncidents) && rawIncidents.length > 0) {
            const formattedIncidents = rawIncidents.map(i => {
                const ip = i.dest_ip || i.attacker_ip || i.ip || "0.0.0.0";
                const localAlerts = readJson(LS_ALERTS, []);
                const incidentAlerts = localAlerts.filter(a => String(a.incidentId) === String(i.id) || String(a.incident_id) === String(i.id));

                // Inherit MITRE techniques from incident alerts
                const mitreTechniques = [];
                const seenMitre = new Set();
                incidentAlerts.forEach(a => {
                    if (a.mitre && a.mitre.id && !seenMitre.has(a.mitre.id)) {
                        seenMitre.add(a.mitre.id);
                        mitreTechniques.push(a.mitre);
                    }
                });

                return {
                    ...i,
                    id: String(i.id),
                    ip: ip,
                    srcIP: ip,
                    alerts: incidentAlerts,
                    alertIds: incidentAlerts.map(a => a.id),
                    severity: i.severity || "medium",
                    status: i.status || "open",
                    correlationScore: Number(i.correlation_score || i.correlationScore || 0),
                    createdAt: i.created_at || i.createdAt || new Date().toISOString(),
                    closedAt: i.closed_at || i.closedAt || "",
                    classification: i.classification || null,
                    owner: i.assigned_to || i.owner || null,
                    assignedTo: i.assigned_to || i.assignedTo || null,
                    caseId: i.case_id || i.caseId || null,
                    mitre: mitreTechniques.length ? mitreTechniques : (i.mitre || [])
                };
            });
            writeJson(LS_INCIDENTS, formattedIncidents);
        }

        if (Array.isArray(rawCases) && rawCases.length > 0) {
            const formattedCases = rawCases.map(c => {
                const incidentId = c.incident_id || c.incidentId;
                const localIncidents = readJson(LS_INCIDENTS, []);
                const inc = localIncidents.find(i => String(i.id) === String(incidentId));

                // Inherit MITRE techniques from case alerts
                const caseAlerts = inc?.alerts || [];
                const mitreTechniques = [];
                const seenMitre = new Set();
                caseAlerts.forEach(a => {
                    if (a.mitre && a.mitre.id && !seenMitre.has(a.mitre.id)) {
                        seenMitre.add(a.mitre.id);
                        mitreTechniques.push(a.mitre);
                    }
                });

                return {
                    ...c,
                    id: String(c.id),
                    incidentId: incidentId ? String(incidentId) : null,
                    status: c.status || "triage",
                    severity: c.severity || "medium",
                    priority: c.priority || c.severity || "medium",
                    createdAt: c.created_at || c.createdAt || new Date().toISOString(),
                    closedAt: c.closed_at || c.closedAt || "",
                    archived: !!c.archived,
                    owner: c.assigned_to || c.owner || null,
                    assignedTo: c.assigned_to || c.assignedTo || null,
                    alerts: caseAlerts,
                    alertIds: inc?.alertIds || [],
                    ip: inc?.ip || "0.0.0.0",
                    affectedMachine: inc?.affectedMachine || { ip: inc?.ip || "0.0.0.0" },
                    mitre: mitreTechniques.length ? mitreTechniques : (c.mitre || []),
                    timeline: c.timeline || [],
                    notes: c.notes || []
                };
            });
            writeJson(LS_CASES, formattedCases);
        }

        console.log("✅ SentinelX: Real backend synchronization complete!");
        emitPlatformDataChanged();
    } catch (err) {
        console.error("❌ SentinelX: Real backend synchronization failed:", err);
    }
}

/** Seed alerts, generate incidents, demo fallback, and cases when storage is empty — fully offline. */
let hydrationComplete = false;

function normalizeBackendNotification(item) {
    return {
        id: item.id,
        text: item.title || item.body || "SOC notification",
        title: item.title,
        body: item.body,
        read: !!item.is_read,
        at: item.created_at ? Date.parse(item.created_at) : Date.now(),
        category: inferNotificationCategory(item.title || item.body, { category: item.type }),
        ...item,
    };
}

function normalizeBackendAuditLog(item) {
    return {
        id: item.id,
        at: item.created_at || new Date().toISOString(),
        analyst: item.user?.name || "System",
        entityType: item.entity_type,
        entityId: item.entity_id,
        details: item.details,
        ...item,
    };
}

async function syncOperationalData(userRole = "analyst") {
    // Dynamically define what to fetch based on role permissions
    const fetchRules = (userRole === "admin" || userRole === "analyst") 
        ? getDetectionRules() 
        : Promise.resolve([]);
        
    const fetchIntegrations = (userRole === "admin") 
        ? getBackendIntegrations() 
        : Promise.resolve([]);
        
    const fetchNotifications = getBackendNotifications({ per_page: 50 });
    
    const fetchAuditLogs = (userRole === "admin") 
        ? getBackendAuditLogs({ per_page: 100 }) 
        : Promise.resolve([]);

    const [rules, integrations, notifications, auditLogs] = await Promise.allSettled([
        fetchRules,
        fetchIntegrations,
        fetchNotifications,
        fetchAuditLogs,
    ]);

    if (rules.status === "fulfilled" && Array.isArray(rules.value)) {
        backendRulesCache = rules.value;
    }

    if (integrations.status === "fulfilled" && Array.isArray(integrations.value)) {
        backendIntegrationsCache = normalizeIntegrationMap(integrations.value);
        window.dispatchEvent(new CustomEvent("soc_integrations_update"));
    }

    if (notifications.status === "fulfilled" && Array.isArray(notifications.value)) {
        backendNotificationsCache = notifications.value.map(normalizeBackendNotification);
        emitNotifications(backendNotificationsCache);
    }

    if (auditLogs.status === "fulfilled" && Array.isArray(auditLogs.value)) {
        backendAuditLogCache = auditLogs.value.map(normalizeBackendAuditLog);
        window.dispatchEvent(new CustomEvent("soc_audit_update"));
    }
}

export function hydrateSocPipeline() {
    if (typeof window === "undefined") return;

    // Trigger real backend sync asynchronously in background
    syncWithBackend();

    try {
        if (hydrationComplete) {
            const currentAlerts = getAlerts();
            const currentIncidents = getIncidents();
            if (Array.isArray(currentAlerts) && currentAlerts.length > 0 && Array.isArray(currentIncidents) && currentIncidents.length > 0) {
                return;
            }
        }

        let alerts = ALERTS_PLAIN;
        if (!alerts || alerts.length === 0) {
            setAlerts([...ALERTS_PLAIN]);
            alerts = ALERTS_PLAIN;
        }
        if (!alerts || alerts.length === 0) return;

        const existingIncidents = getIncidents();
        if (!Array.isArray(existingIncidents) || existingIncidents.length === 0) {
            const incidentsGenerated = correlateAlerts(alerts);
            if (Array.isArray(incidentsGenerated)) {
                setIncidents(incidentsGenerated);
            }
        } else if (!hydrationComplete) {
            const incidentsGenerated = correlateAlerts(alerts);
            if (Array.isArray(incidentsGenerated)) {
                setIncidents(incidentsGenerated);
            }
        }

        console.log("HYDRATING PIPELINE");
        const incidents = getIncidents();
        if (Array.isArray(incidents) && incidents.length > 0) {
            window.dispatchEvent(new Event("soc_platform_data"));
        }

        hydrationComplete = true;
    } catch (e) {
        console.error("Error hydrating SOC pipeline:", e);
    }
}
