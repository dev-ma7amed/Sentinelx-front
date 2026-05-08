import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Search, TrendingDown, TrendingUp, Minus, CheckCircle, Clock, AlertCircle, Bell, Settings } from "lucide-react";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import { logoutSession, getCurrentUser, userDisplayName } from "../session";
import { getAuditLog, getIncidents, getAlerts, getCases, calculateMetrics } from "../platformStore";
import { formatTime } from "../utils/formatTime";
import { Chart, registerables } from "chart.js";
import "../styles/AuditMetrics.css";

Chart.register(...registerables);

// Format duration in milliseconds to human-readable format
function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 60) return `${totalMin}m`;
    const totalHours = Math.floor(totalMin / 60);
    if (totalHours < 24) {
        const m = totalMin % 60;
        return m > 0 ? `${totalHours}h ${m}m` : `${totalHours}h`;
    }
    const days = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    return h > 0 ? `${days}d ${h}h` : `${days}d`;
}

// Helper to get incidents within a time range
function getIncidentsInRange(incidents, rangeKey) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let cutoff = now - (30 * day);
    if (rangeKey === "24h") cutoff = now - day;
    else if (rangeKey === "7d") cutoff = now - (7 * day);

    return (Array.isArray(incidents) ? incidents : []).filter((i) => {
        const t = Date.parse(i.createdAt);
        return Number.isFinite(t) && t >= cutoff;
    });
}

// Helper to get cases within a time range
function getCasesInRange(cases, rangeKey) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let cutoff = now - (30 * day);
    if (rangeKey === "24h") cutoff = now - day;
    else if (rangeKey === "7d") cutoff = now - (7 * day);

    return (Array.isArray(cases) ? cases : []).filter((c) => {
        const t = Date.parse(c.createdAt);
        return Number.isFinite(t) && t >= cutoff;
    });
}

// Unified helpers for field name variations
function isResolved(item) {
    return (
        item?.status === "closed" ||
        item?.status === "resolved"
    );
}

function getResolvedTime(item) {
    return item?.resolvedAt || item?.closedAt || null;
}

function getClassification(item) {
    return (
        item?.classification ||
        item?.resolution ||
        "unknown"
    );
}

function LineChartComp({ dataKey, statusFilter, incidents }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return undefined;

        // Generate dynamic trend data from incidents
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        let labels, dataPoints;

        if (dataKey === "24h") {
            labels = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"];
            dataPoints = labels.map((_, i) => {
                const start = now - (24 * day) + (i * 4 * 60 * 60 * 1000);
                const end = start + (4 * 60 * 60 * 1000);
                const inRange = (Array.isArray(incidents) ? incidents : []).filter((inc) => {
                    const t = Date.parse(inc.createdAt);
                    return Number.isFinite(t) && t >= start && t < end;
                });
                // Calculate average MTTR for this period
                const resolved = inRange.filter((i) => isResolved(i) && i.createdAt && getResolvedTime(i));
                if (resolved.length === 0) return 0.5;
                const avgMttr = resolved.reduce((sum, i) => {
                    const diff = Date.parse(getResolvedTime(i)) - Date.parse(i.createdAt);
                    return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
                }, 0) / resolved.length;
                // Convert to hours and scale to 0-5 range
                const hours = avgMttr / (60 * 60 * 1000);
                return Math.min(5, Math.max(0.5, hours / 2));
            });
        } else if (dataKey === "7d") {
            labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            dataPoints = labels.map((_, i) => {
                const start = now - (7 * day) + (i * day);
                const end = start + day;
                const inRange = (Array.isArray(incidents) ? incidents : []).filter((inc) => {
                    const t = Date.parse(inc.createdAt);
                    return Number.isFinite(t) && t >= start && t < end;
                });
                const resolved = inRange.filter((i) => isResolved(i) && i.createdAt && getResolvedTime(i));
                if (resolved.length === 0) return 0.5;
                const avgMttr = resolved.reduce((sum, i) => {
                    const diff = Date.parse(getResolvedTime(i)) - Date.parse(i.createdAt);
                    return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
                }, 0) / resolved.length;
                const hours = avgMttr / (60 * 60 * 1000);
                return Math.min(5, Math.max(0.5, hours / 2));
            });
        } else {
            labels = ["W1", "W2", "W3", "W4"];
            dataPoints = labels.map((_, i) => {
                const start = now - (30 * day) + (i * 7 * day);
                const end = start + (7 * day);
                const inRange = (Array.isArray(incidents) ? incidents : []).filter((inc) => {
                    const t = Date.parse(inc.createdAt);
                    return Number.isFinite(t) && t >= start && t < end;
                });
                const resolved = inRange.filter((i) => isResolved(i) && i.createdAt && getResolvedTime(i));
                if (resolved.length === 0) return 0.5;
                const avgMttr = resolved.reduce((sum, i) => {
                    const diff = Date.parse(getResolvedTime(i)) - Date.parse(i.createdAt);
                    return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
                }, 0) / resolved.length;
                const hours = avgMttr / (60 * 60 * 1000);
                return Math.min(5, Math.max(0.5, hours / 2));
            });
        }

        const chart = new Chart(ref.current, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    data: dataPoints,
                    borderColor: "#2badee",
                    borderWidth: 3,
                    fill: true,
                    backgroundColor: "rgba(43,173,238,0.12)",
                    tension: 0.45,
                    pointRadius: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: { display: false },
                    y: { display: false, min: 0, max: 5 }
                }
            }
        });
        return () => chart.destroy();
    }, [dataKey, statusFilter, incidents]);
    return <canvas ref={ref} />;
}

function BarChartComp({ dataKey, statusFilter, incidents }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return undefined;

        // Calculate analyst workload from incidents and audit logs
        const auditLog = getAuditLog();
        const analysts = {};
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;

        // Determine time range cutoff
        let cutoff = now - (30 * day);
        if (dataKey === "24h") cutoff = now - day;
        else if (dataKey === "7d") cutoff = now - (7 * day);

        // Count actions per analyst from audit log
        (Array.isArray(auditLog) ? auditLog : []).forEach((entry) => {
            const t = Date.parse(entry.at);
            if (!Number.isFinite(t) || t < cutoff) return;

            const analyst = entry.analyst || "Unassigned";
            if (!analysts[analyst]) analysts[analyst] = 0;
            analysts[analyst]++;
        });

        // If no audit data, fall back to incident assignments
        if (Object.keys(analysts).length === 0) {
            (Array.isArray(incidents) ? incidents : []).forEach((inc) => {
                const t = Date.parse(inc.createdAt);
                if (!Number.isFinite(t) || t < cutoff) return;

                const analyst = inc.owner || inc.assignedTo || "Unassigned";
                if (!analysts[analyst]) analysts[analyst] = 0;
                analysts[analyst]++;
            });
        }

        const labels = Object.keys(analysts).slice(0, 5);
        const data = labels.map((a) => analysts[a] * 50);

        const topLabelsPlugin = {
            id: "topLabels",
            afterDatasetsDraw(chart) {
                const { ctx, data } = chart;
                const colors = ["#92b7c9", "#2badee", "#92b7c9", "#92b7c9", "#92b7c9"];
                data.datasets[0].data.forEach((val, i) => {
                    const meta = chart.getDatasetMeta(0).data[i];
                    if (!meta) return;
                    ctx.save();
                    ctx.fillStyle = colors[i];
                    ctx.font = "600 11px sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText(val, meta.x, meta.y - 8);
                    ctx.restore();
                });
            }
        };
        const chart = new Chart(ref.current, {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: ["rgba(43,173,238,0.2)", "#2badee", "rgba(43,173,238,0.2)", "rgba(43,173,238,0.2)", "rgba(43,173,238,0.2)"],
                    borderRadius: 4,
                    borderSkipped: false,
                    barPercentage: 0.55,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 24 } },
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            color: (ctx) => ctx.index === 1 ? "#2badee" : "#92b7c9",
                            font: { size: 10, weight: "bold" },
                        }
                    },
                    y: { display: false, min: 0, max: 560 }
                }
            },
            plugins: [topLabelsPlugin]
        });
        return () => chart.destroy();
    }, [dataKey, statusFilter, incidents]);
    return <canvas ref={ref} />;
}

function calculateAnalystWorkload(auditLog, rangeKey) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let cutoff = now - (30 * day);
    if (rangeKey === "24h") cutoff = now - day;
    else if (rangeKey === "7d") cutoff = now - (7 * day);

    const analysts = {};
    (Array.isArray(auditLog) ? auditLog : []).forEach((entry) => {
        const t = Date.parse(entry.at);
        if (!Number.isFinite(t) || t < cutoff) return;

        const analyst = entry.analyst || "Unassigned";
        if (!analysts[analyst]) analysts[analyst] = 0;
        analysts[analyst]++;
    });

    const counts = Object.values(analysts);
    const average = counts.length > 0 ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length) : 0;

    // Calculate percentage change (mock: compare to previous period)
    const previousCutoff = cutoff - (cutoff - (now - (60 * day)));
    const previousAnalysts = {};
    (Array.isArray(auditLog) ? auditLog : []).forEach((entry) => {
        const t = Date.parse(entry.at);
        if (!Number.isFinite(t) || t < previousCutoff || t >= cutoff) return;

        const analyst = entry.analyst || "Unassigned";
        if (!previousAnalysts[analyst]) previousAnalysts[analyst] = 0;
        previousAnalysts[analyst]++;
    });

    const previousCounts = Object.values(previousAnalysts);
    const previousAverage = previousCounts.length > 0 ? Math.round(previousCounts.reduce((a, b) => a + b, 0) / previousCounts.length) : 0;

    const percentageChange = previousAverage > 0 ? Math.round(((average - previousAverage) / previousAverage) * 100) : 0;
    const trend = percentageChange > 0 ? "up" : percentageChange < 0 ? "down" : "neutral";

    return { average, percentageChange, trend };
}

function calculateDetectionQualityTrend(incidents, rangeKey) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let cutoff = now - (30 * day);
    if (rangeKey === "24h") cutoff = now - day;
    else if (rangeKey === "7d") cutoff = now - (7 * day);

    const rangeIncidents = (Array.isArray(incidents) ? incidents : []).filter((i) => {
        const t = Date.parse(i.createdAt);
        return Number.isFinite(t) && t >= cutoff;
    });

    const resolved = rangeIncidents.filter((i) => i.status === "closed" || i.status === "resolved");

    if (resolved.length === 0) {
        return { avgMttr: "—", percentageChange: "0%", trend: "neutral" };
    }

    const totalMs = resolved.reduce((sum, i) => {
        const diff = Date.parse(i.resolvedAt) - Date.parse(i.createdAt);
        return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
    }, 0);

    const avgMttrMs = totalMs / resolved.length;
    const avgMttr = formatDuration(avgMttrMs);

    // Calculate percentage change
    const previousCutoff = cutoff - (cutoff - (now - (60 * day)));
    const previousIncidents = (Array.isArray(incidents) ? incidents : []).filter((i) => {
        const t = Date.parse(i.createdAt);
        return Number.isFinite(t) && t >= previousCutoff && t < cutoff;
    });

    const previousResolved = previousIncidents.filter((i) => i.status === "closed" || i.status === "resolved");
    let percentageChange = "0%";
    let trend = "neutral";

    if (previousResolved.length > 0) {
        const previousTotalMs = previousResolved.reduce((sum, i) => {
            const diff = Date.parse(i.resolvedAt) - Date.parse(i.createdAt);
            return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
        }, 0);

        const previousAvgMttrMs = previousTotalMs / previousResolved.length;
        const change = Math.round(((avgMttrMs - previousAvgMttrMs) / previousAvgMttrMs) * 100);
        percentageChange = `${change > 0 ? "+" : ""}${change}%`;
        trend = change < 0 ? "down" : change > 0 ? "up" : "neutral";
    }

    return { avgMttr, percentageChange, trend };
}

function getLatestAuditForIncident(incidentId, auditLog) {
    const entries = (Array.isArray(auditLog) ? auditLog : [])
        .filter((e) => e.incidentId === incidentId || e.entityId === incidentId)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return entries.length > 0 ? entries[0] : null;
}

function getResolutionFromAudit(incident, latestAudit) {
    if (!latestAudit) {
        // Fallback to incident state if no audit log
        const classification = String(incident.classification || "").toLowerCase();
        const status = String(incident.status || "").toLowerCase();

        if (classification === "true_positive") return "Closed — Remediated";
        if (classification === "false_positive") return "Closed — False Positive";
        if (classification === "duplicate") return "Closed — Duplicate";
        if (status === "closed") return "Closed — Resolved";
        if (status === "resolved") return "Closed — Resolved";
        return "Pending Review";
    }

    const action = String(latestAudit.action || "").toLowerCase();
    const decision = String(latestAudit.classification || latestAudit.decision || "").toLowerCase();

    // Check decision field first (from classify_incident action)
    if (decision === "true_positive") return "Closed — Remediated";
    if (decision === "false_positive") return "Closed — False Positive";
    if (decision === "duplicate") return "Closed — Duplicate";

    // Check action field
    if (action.includes("classify")) {
        if (decision === "true_positive") return "Closed — Remediated";
        if (decision === "false_positive") return "Closed — False Positive";
        if (decision === "duplicate") return "Closed — Duplicate";
    }
    if (action.includes("close")) return "Closed — Resolved";
    if (action.includes("resolve")) return "Closed — Resolved";
    if (action.includes("block")) return "Closed — Threat Blocked";
    if (action.includes("escalate")) return "Escalated — Under Investigation";

    return "Pending Review";
}

function getDetailsFromAudit(incident, latestAudit) {
    const classification = String(incident.classification || "").toLowerCase();
    const severity = String(incident.severity || "").toLowerCase();
    const stages = Array.isArray(incident.stages) ? incident.stages : [];
    const blocked = incident.networkBlocked ? true : false;

    // Generate context-aware descriptions based on incident data
    if (classification === "true_positive") {
        if (severity === "critical") {
            return blocked
                ? "Critical threat isolated and remediated successfully"
                : "Critical threat contained and remediation initiated";
        }
        if (severity === "high") {
            return blocked
                ? "High-severity threat blocked and contained"
                : "High-severity threat contained after suspicious activity";
        }
        return blocked
            ? "Malware isolated and threat remediated"
            : "Threat remediated and case closed";
    }

    if (classification === "false_positive") {
        return "False positive confirmed after analyst review";
    }

    if (classification === "duplicate") {
        return "Duplicate incident merged into existing case";
    }

    if (latestAudit) {
        const action = String(latestAudit.action || "").toLowerCase();
        if (action.includes("escalate")) {
            return "Escalated for advanced investigation";
        }
        if (action.includes("block")) {
            return "Malicious traffic blocked by analyst";
        }
    }

    if (stages.includes("C2")) {
        return "C2 communication detected and blocked";
    }
    if (stages.includes("Execution")) {
        return "Malicious execution detected and contained";
    }
    if (stages.includes("Access")) {
        return "Unauthorized access attempt detected and blocked";
    }

    return "Incident investigated and resolved";
}

function getAuditStatusFromAction(latestAudit) {
    if (!latestAudit) return "pending";

    const action = String(latestAudit.action || "").toLowerCase();

    if (action.includes("classify") || action.includes("close") || action.includes("resolve")) {
        return "verified";
    }
    if (action.includes("escalate")) {
        return "flagged";
    }
    if (action.includes("investigate") || action.includes("assign")) {
        return "pending";
    }

    return "pending";
}

function getResolutionText(incident) {
    const classification = String(incident.classification || "").toLowerCase();
    const status = String(incident.status || "").toLowerCase();
    const escalated = incident.escalated || incident.autoEscalated;

    if (classification === "true_positive") {
        if (status === "resolved") return "True Positive — Remediated";
        if (escalated) return "True Positive — Escalated";
        return "True Positive — Contained";
    }
    if (classification === "false_positive") return "False Positive — Whitelisted";
    if (classification === "duplicate") return "Duplicate — Merged";
    if (status === "resolved") return "Resolved — Closed";
    if (escalated) return "Escalated — Under Investigation";
    return "Pending Review";
}

function buildResolutionLabel(incident, latestAudit) {
    const classification = String(incident.classification || "").toLowerCase();
    const action = latestAudit ? String(latestAudit.action || "").toLowerCase() : "";
    const escalated = incident.escalated || incident.autoEscalated;

    if (classification === "true_positive") {
        if (action.includes("remediat")) return "True Positive — Remediated";
        if (action.includes("isolat")) return "True Positive — Isolated";
        if (action.includes("contain")) return "True Positive — Contained";
        return "True Positive — Contained";
    }

    if (classification === "false_positive") return "False Positive — Closed";

    if (escalated) return "Undetermined — Escalated";

    if (action.includes("close") || action.includes("resolve")) return "Resolved";

    return "Resolved";
}

function getAuditDetails(incident, latestAudit) {
    const classification = String(incident.classification || "").toLowerCase();
    const action = latestAudit ? String(latestAudit.action || "").toLowerCase() : "";
    const escalated = incident.escalated || incident.autoEscalated;

    if (classification === "true_positive") {
        if (action.includes("remediat")) return "Threat remediated and case closed";
        if (action.includes("isolat")) return "Host isolated successfully";
        if (action.includes("contain")) return "Threat contained and monitored";
        return "Threat contained and monitored";
    }

    if (classification === "false_positive") return "False positive after investigation";

    if (escalated) return "Escalated to SOC Lead";

    if (latestAudit?.message) return latestAudit.message;

    return "Incident resolved";
}

function getAuditStatus(incident) {
    const status = String(incident.status || "").toLowerCase();
    const classification = String(incident.classification || "").toLowerCase();
    const escalated = incident.escalated || incident.autoEscalated;

    if (status === "resolved" || status === "closed") return "verified";
    if (status === "open" && !escalated) return "pending";
    if (classification === "false_positive" || escalated) return "flagged";
    return "pending";
}

function computeRealMttr(incidents) {
    const resolved = (Array.isArray(incidents) ? incidents : []).filter(
        (i) => (i.status === "resolved" || i.status === "closed") && i.resolvedAt && i.createdAt
    );
    if (!resolved.length) return null;
    const totalMs = resolved.reduce((sum, i) => {
        const diff = Date.parse(i.resolvedAt) - Date.parse(i.createdAt);
        return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
    }, 0);
    return totalMs / resolved.length;
}

const tableRowsSeed = [
    { id: "#INC-9421", analyst: "D. Miller", resolution: "True Positive - Remedied", duration: "42m", status: "verified", bucket: "30d" },
    { id: "#INC-9398", analyst: "K. Jha", resolution: "False Positive - Whitelisted", duration: "12m", status: "verified", bucket: "30d" },
    { id: "#INC-9382", analyst: "M. Ross", resolution: "True Positive - Isolated", duration: "3h 15m", status: "pending", bucket: "7d" },
    { id: "#INC-9377", analyst: "A. Smith", resolution: "Undetermined - Escalated", duration: "24m", status: "flagged", bucket: "7d" },
    { id: "#INC-9366", analyst: "R. Patel", resolution: "True Positive - Contained", duration: "55m", status: "verified", bucket: "24h" },
    { id: "#INC-9361", analyst: "L. Chen", resolution: "Duplicate - Merged", duration: "8m", status: "verified", bucket: "24h" },
    { id: "#INC-9355", analyst: "S. Diaz", resolution: "Pending vendor review", duration: "2h 01m", status: "pending", bucket: "30d" },
    { id: "#INC-9350", analyst: "T. Wu", resolution: "Policy exception logged", duration: "19m", status: "flagged", bucket: "30d" },
];

const statusConfig = {
    verified: { label: "Verified", icon: <CheckCircle size={13} />, cls: "am-status-verified" },
    pending: { label: "Pending", icon: <Clock size={13} />, cls: "am-status-pending" },
    flagged: { label: "Flagged", icon: <AlertCircle size={13} />, cls: "am-status-flagged" },
};

export default function AuditMetrics() {
    const navigate = useNavigate();
    const [timeRange, setTimeRange] = useState("30d");
    const [tableSearch, setTableSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [auditTick, setAuditTick] = useState(0);

    useEffect(() => {
        const onUpdate = () => setAuditTick((n) => n + 1);
        window.addEventListener("soc_audit_update", onUpdate);
        window.addEventListener("soc_platform_data", onUpdate);
        return () => {
            window.removeEventListener("soc_audit_update", onUpdate);
            window.removeEventListener("soc_platform_data", onUpdate);
        };
    }, []);

    // Get fresh data from store on every tick
    const allIncidents = useMemo(() => getIncidents(), [auditTick]);
    const allCases = useMemo(() => getCases(), [auditTick]);
    const auditLogData = useMemo(() => getAuditLog(), [auditTick]);
    const metricsData = useMemo(() => calculateMetrics(), [auditTick]);

    const displayStats = useMemo(() => {
        const alerts = getAlerts?.() || [];
        const alertVolume = alerts.length;
        const incidents = getIncidents();
        const cases = getCases();

        // Calculate MTTR trend
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        let mttrCutoff = now - (30 * day);
        if (timeRange === "24h") mttrCutoff = now - day;
        else if (timeRange === "7d") mttrCutoff = now - (7 * day);

        const currentPeriodIncidents = incidents.filter((i) => {
            const t = Date.parse(i.createdAt);
            return Number.isFinite(t) && t >= mttrCutoff;
        });
        const currentResolved = currentPeriodIncidents.filter((i) => isResolved(i) && i.createdAt && getResolvedTime(i));
        const currentMttrMs = currentResolved.length > 0
            ? currentResolved.reduce((sum, i) => {
                const diff = Date.parse(getResolvedTime(i)) - Date.parse(i.createdAt);
                return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
            }, 0) / currentResolved.length
            : 0;

        const previousCutoff = mttrCutoff - (mttrCutoff - (now - (60 * day)));
        const previousIncidents = incidents.filter((i) => {
            const t = Date.parse(i.createdAt);
            return Number.isFinite(t) && t >= previousCutoff && t < mttrCutoff;
        });
        const previousResolved = previousIncidents.filter((i) => isResolved(i) && i.createdAt && getResolvedTime(i));
        const previousMttrMs = previousResolved.length > 0
            ? previousResolved.reduce((sum, i) => {
                const diff = Date.parse(getResolvedTime(i)) - Date.parse(i.createdAt);
                return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
            }, 0) / previousResolved.length
            : 0;

        let mttrChange = "0%";
        let mttrTrend = "neutral";
        if (previousMttrMs > 0 && currentMttrMs > 0) {
            const change = Math.round(((currentMttrMs - previousMttrMs) / previousMttrMs) * 100);
            mttrChange = `${change > 0 ? "+" : ""}${change}%`;
            mttrTrend = change < 0 ? "down" : change > 0 ? "up" : "neutral";
        }

        // Calculate alert volume trend
        const currentAlerts = alerts.filter((a) => {
            const t = Date.parse(a.createdAt);
            return Number.isFinite(t) && t >= mttrCutoff;
        }).length;
        const previousAlerts = alerts.filter((a) => {
            const t = Date.parse(a.createdAt);
            return Number.isFinite(t) && t >= previousCutoff && t < mttrCutoff;
        }).length;
        let alertChange = "0%";
        let alertTrend = "neutral";
        if (previousAlerts > 0) {
            const change = Math.round(((currentAlerts - previousAlerts) / previousAlerts) * 100);
            alertChange = `${change > 0 ? "+" : ""}${change}%`;
            alertTrend = change < 0 ? "down" : change > 0 ? "up" : "neutral";
        }

        // Calculate FP rate trend from incidents
        const fpCurrentIncidents = currentPeriodIncidents.filter((i) => isResolved(i));
        const currentFP = fpCurrentIncidents.filter((i) => getClassification(i) === "false_positive").length;
        const currentFPRate = fpCurrentIncidents.length > 0 ? Math.round((currentFP / fpCurrentIncidents.length) * 100) : 0;

        const fpPreviousIncidents = previousIncidents.filter((i) => isResolved(i));
        const previousFP = fpPreviousIncidents.filter((i) => getClassification(i) === "false_positive").length;
        const previousFPRate = fpPreviousIncidents.length > 0 ? Math.round((previousFP / fpPreviousIncidents.length) * 100) : 0;

        let fpChange = "0%";
        let fpTrend = "neutral";
        if (previousFPRate > 0 || currentFPRate > 0) {
            const change = currentFPRate - previousFPRate;
            fpChange = `${change > 0 ? "+" : ""}${change}%`;
            fpTrend = change < 0 ? "down" : change > 0 ? "up" : "neutral";
        }

        // Calculate detection efficacy trend from incidents
        const tpCurrentIncidents = fpCurrentIncidents.filter((i) => getClassification(i) === "true_positive").length;
        const currentEfficacy = fpCurrentIncidents.length > 0 ? Math.round((tpCurrentIncidents / fpCurrentIncidents.length) * 100) : 0;

        const tpPreviousIncidents = fpPreviousIncidents.filter((i) => getClassification(i) === "true_positive").length;
        const previousEfficacy = fpPreviousIncidents.length > 0 ? Math.round((tpPreviousIncidents / fpPreviousIncidents.length) * 100) : 0;

        let efficacyChange = "0%";
        let efficacyTrend = "neutral";
        if (previousEfficacy > 0 || currentEfficacy > 0) {
            const change = currentEfficacy - previousEfficacy;
            efficacyChange = `${change > 0 ? "+" : ""}${change}%`;
            efficacyTrend = change < 0 ? "down" : change > 0 ? "up" : "neutral";
        }

        return [
            {
                label: "Avg MTTR",
                value: currentMttrMs > 0 ? formatDuration(currentMttrMs) : "—",
                change: mttrChange,
                trend: mttrTrend,
                barColor: "#fa5f38",
                barWidth: currentMttrMs > 0 ? `${Math.min(100, (currentMttrMs / (4 * 60 * 60 * 1000)) * 100)}%` : "0%",
            },
            {
                label: "Alert Volume",
                value: currentAlerts.toLocaleString(),
                change: alertChange,
                trend: alertTrend,
                barColor: "#2badee",
                barWidth: `${Math.min(100, (currentAlerts / 500) * 100)}%`,
            },
            {
                label: "False Positive Rate",
                value: `${currentFPRate}%`,
                change: fpChange,
                trend: fpTrend,
                barColor: "#facc15",
                barWidth: `${currentFPRate}%`,
            },
            {
                label: "Detection Efficacy",
                value: `${currentEfficacy}%`,
                change: efficacyChange,
                trend: efficacyTrend,
                barColor: "#0bda57",
                barWidth: `${currentEfficacy}%`,
            },
        ];
    }, [metricsData, allIncidents, allCases, timeRange, auditTick]);

    const realAuditRows = useMemo(() => {
        const rawAudit = getAuditLog();
        const entries = Array.isArray(rawAudit) ? rawAudit : [];
        if (!entries.length) return tableRowsSeed;
        const allIncidents = getIncidents();
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        const statusMap = {
            false_positive: "verified",
            classified_true: "verified",
            classified_false: "verified",
            classification: "verified",
            investigating: "pending",
            assigned: "pending",
            "auto-escalate": "flagged",
            "create case": "verified",
            assign_incident: "pending",
            investigate_incident: "pending",
            classify_incident: "verified",
            escalate_case: "flagged",
        };
        return entries.map((e, idx) => {
            const t = Date.parse(e.at);
            let bucket = "30d";
            if (Number.isFinite(t)) {
                const age = now - t;
                if (age <= day) bucket = "24h";
                else if (age <= 7 * day) bucket = "7d";
            }
            let duration = "—";
            if (e.entityId) {
                const inc = allIncidents.find((i) => i.id === e.entityId);
                if (inc?.resolvedAt && inc?.createdAt) {
                    const ms = Date.parse(inc.resolvedAt) - Date.parse(inc.createdAt);
                    if (Number.isFinite(ms) && ms > 0) {
                        duration = formatDuration(ms);
                    }
                }
            }
            const base = `${e.action || "Action"} — ${e.message || ""}`.trim();
            const timePart = e.at && Number.isFinite(t) ? ` · ${formatTime(e.at)}` : "";
            return {
                id: e.entityId ? `#${e.entityId}` : `#AUD-${idx + 1}`,
                analyst: e.analyst || "SOC User",
                role: e.role || "analyst",
                action: e.action || "unknown",
                resolution: `${base}${timePart}`,
                duration,
                status: statusMap[e.action] || "verified",
                bucket,
                timestamp: e.at,
                details: e.details || "",
            };
        });
    }, [auditTick]);

    const filteredRows = useMemo(() => {
        let rows = (Array.isArray(realAuditRows) ? realAuditRows : []).filter((r) => {
            if (timeRange === "30d") return true;
            if (timeRange === "7d") return r.bucket === "7d" || r.bucket === "24h";
            if (timeRange === "24h") return r.bucket === "24h";
            return true;
        });
        if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
        const q = tableSearch.trim().toLowerCase();
        if (q) {
            rows = rows.filter(
                (r) =>
                    String(r?.id || "").toLowerCase().includes(q) ||
                    String(r?.analyst || "").toLowerCase().includes(q) ||
                    String(r?.resolution || "").toLowerCase().includes(q)
            );
        }
        return rows;
    }, [tableSearch, statusFilter, timeRange, realAuditRows]);

    const auditClosures = useMemo(() => {
        const resolved = (Array.isArray(allIncidents) ? allIncidents : [])
            .filter((i) => (i.status === "resolved" || i.status === "closed") && i.resolvedAt && i.createdAt)
            .sort((a, b) => Date.parse(b.resolvedAt) - Date.parse(a.resolvedAt))
            .slice(0, 10);

        if (resolved.length === 0) {
            // Fallback to closed cases if no resolved incidents
            const closedCases = (Array.isArray(allCases) ? allCases : [])
                .filter((c) => c.status === "closed")
                .sort((a, b) => Date.parse(b.closedAt || b.createdAt) - Date.parse(a.closedAt || a.createdAt))
                .slice(0, 10);

            return closedCases.map((caseItem) => {
                const ms = caseItem.closedAt && caseItem.createdAt
                    ? Date.parse(caseItem.closedAt) - Date.parse(caseItem.createdAt)
                    : 0;
                const duration = Number.isFinite(ms) && ms > 0 ? formatDuration(ms) : "—";

                const latestAudit = getLatestAuditForIncident(caseItem.id, auditLogData);
                const resolution = buildResolutionLabel(caseItem, latestAudit);
                const details = getAuditDetails(caseItem, latestAudit);
                const status = getAuditStatusFromAction(latestAudit);
                const analyst = latestAudit?.analyst || caseItem.assignedTo || "SOC Analyst";

                return {
                    id: `#${caseItem.id}`,
                    analyst,
                    resolution,
                    duration,
                    status,
                    details,
                    incidentId: caseItem.id,
                };
            });
        }

        return resolved.map((incident) => {
            const ms = Date.parse(incident.resolvedAt) - Date.parse(incident.createdAt);
            const duration = Number.isFinite(ms) && ms > 0 ? formatDuration(ms) : "—";

            const latestAudit = getLatestAuditForIncident(incident.id, auditLogData);
            const resolution = buildResolutionLabel(incident, latestAudit);
            const details = getAuditDetails(incident, latestAudit);
            const status = getAuditStatusFromAction(latestAudit);
            const analyst = latestAudit?.analyst || incident.resolvedBy || "SOC Analyst";

            return {
                id: `#${incident.id}`,
                analyst,
                resolution,
                duration,
                status,
                details,
                incidentId: incident.id,
            };
        });
    }, [allIncidents, allCases, auditLogData, auditTick]);

    let page;
    try {
        page = (
        <div className="am-page">

            {/* TOPBAR */}
            <header className="am-topbar">
                <div className="am-topbar-left">
                    <div className="am-logo">
                        <SocLogo />
                    </div>
                    <nav className="am-nav">
                        <NavLink to="/dashboard">Dashboard</NavLink>
                        <NavLink to="/alerts">Alerts</NavLink>
                        <NavLink to="/incidents">Incidents</NavLink>
                        <NavLink to="/intelligence">Intelligence</NavLink>
                        <NavLink to="/cases">Cases</NavLink>
                        <NavLink to="/audit" className="active">Audit &amp; Metrics</NavLink>
                        <NavLink to="/settings">Settings</NavLink>
                    </nav>
                </div>
                <div className="am-topbar-right">
                    <div className="am-search">
                        <Search size={16} />
                        <input
                            value={tableSearch}
                            onChange={(e) => setTableSearch(e.target.value)}
                            placeholder="Search metrics..."
                        />
                    </div>
                    <button type="button" className="am-export-btn" onClick={() => {
                        const payload = { timeRange, statusFilter, tableSearch, rows: filteredRows };
                        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `audit-metrics-${timeRange}.json`;
                        a.click();
                    }}>Export Report</button>
                    <HeaderNotificationBell className="am-export-btn">
                        <Bell size={16} />
                    </HeaderNotificationBell>
                    <HeaderSettingsNav className="am-export-btn">
                        <Settings size={16} />
                    </HeaderSettingsNav>
                    <HeaderMenuAvatar
                        className="am-avatar"
                        onLogout={() => { logoutSession(); navigate("/"); }}
                    />
                </div>
            </header>

            {/* MAIN */}
            <main className="am-main">
                <div className="am-container">

                    {/* PAGE HEADER */}
                    <div className="am-page-header">
                        <div>
                            <h1 className="am-page-title">Incident Response Performance &amp; Audit</h1>
                            <p className="am-last-update">Last updated: 2 minutes ago</p>
                        </div>
                        <div className="am-header-btns">
                            <button type="button" className="am-filter-btn" onClick={() => setTimeRange((t) => (t === "30d" ? "7d" : t === "7d" ? "24h" : "30d"))}>
                                {timeRange === "30d" ? "Last 30 Days" : timeRange === "7d" ? "Last 7 Days" : "Last 24 Hours"}
                            </button>
                            <button type="button" className="am-filter-btn" onClick={() => setStatusFilter((s) => (s === "all" ? "verified" : s === "verified" ? "pending" : s === "pending" ? "flagged" : "all"))}>
                                Status: {statusFilter}
                            </button>
                        </div>
                    </div>

                    {/* STATS GRID */}
                    <div className="am-stats-grid">
                        {displayStats.map((s, i) => (
                            <div key={`stat-${s.label}-${i}`} className="am-stat-card">
                                <p className="am-stat-label">{s.label}</p>
                                <div className="am-stat-row">
                                    <p className="am-stat-value">{s.value}</p>
                                    <span className={`am-stat-change am-${s.trend}`}>
                                        {s.trend === "up" && <TrendingUp size={12} />}
                                        {s.trend === "down" && <TrendingDown size={12} />}
                                        {s.trend === "neutral" && <Minus size={12} />}
                                        {s.change}
                                    </span>
                                </div>
                                <div className="am-progress">
                                    <div className="am-progress-fill" style={{ width: s.barWidth, background: s.barColor }} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* MTTR METRICS CARD */}
                    <div className="am-mttr-card">
                        <div className="am-mttr-header">
                            <div>
                                <h3>Mean Time To Resolution (MTTR)</h3>
                                <p>Average time from incident creation to resolution</p>
                            </div>
                            <div className="am-mttr-value">
                                {(() => {
                                    const allIncidents = getIncidents();
                                    const mttrMs = computeRealMttr(allIncidents);
                                    const resolvedCount = (Array.isArray(allIncidents) ? allIncidents : []).filter(
                                        (i) => (i.status === "resolved" || i.status === "closed") && i.resolvedAt && i.createdAt
                                    ).length;
                                    return (
                                        <>
                                            <span className="am-mttr-display">{mttrMs ? formatDuration(mttrMs) : "—"}</span>
                                            <span className="am-mttr-count">{resolvedCount} resolved incidents</span>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>

                    {/* SECTION HEADER */}
                    <div className="am-section-header">
                        <h2>Operational Efficiency Trends</h2>
                        <div className="am-legend">
                            <span><span className="am-dot blue" />MTTR</span>
                            <span><span className="am-dot gray" />Volume</span>
                        </div>
                    </div>

                    {/* CHARTS */}
                    <div className="am-charts-grid">

                        <div className="am-chart-card">
                            <div className="am-chart-header">
                                <div>
                                    <h3>Detection Quality Trend</h3>
                                    <p>Response accuracy vs speed correlation</p>
                                </div>
                                <div className="am-chart-summary">
                                    {(() => {
                                        const allIncidents = getIncidents();
                                        const trend = calculateDetectionQualityTrend(allIncidents, timeRange);
                                        return (
                                            <>
                                                <span className="am-chart-avg">{trend.avgMttr} Avg</span>
                                                <span className={`am-trend-${trend.trend === "down" ? "negative" : trend.trend === "up" ? "positive" : "neutral"}`}>
                                                    {trend.percentageChange} vs last period
                                                </span>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                            <div className="am-line-chart-wrap">
                                <LineChartComp dataKey={timeRange} statusFilter={statusFilter} incidents={getIncidents()} />
                            </div>
                            <div className="am-days">
                                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, idx) => <span key={`day-${d}-${idx}`}>{d}</span>)}
                            </div>
                        </div>

                        <div className="am-chart-card">
                            <div className="am-chart-header">
                                <div>
                                    <h3>Analyst Workload Distribution</h3>
                                    <p>Alerts processed per responder</p>
                                </div>
                                <div className="am-chart-summary">
                                    {(() => {
                                        const auditLog = getAuditLog();
                                        const workload = calculateAnalystWorkload(auditLog, timeRange);
                                        return (
                                            <>
                                                <span className="am-chart-avg">{workload.average} avg</span>
                                                <span className={`am-trend-${workload.trend === "down" ? "negative" : workload.trend === "up" ? "positive" : "neutral"}`}>
                                                    {workload.percentageChange > 0 ? "+" : ""}{workload.percentageChange}% vs last period
                                                </span>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                            <div className="am-bar-chart-wrap">
                                <BarChartComp dataKey={timeRange} statusFilter={statusFilter} incidents={getIncidents()} />
                            </div>
                        </div>

                    </div>

                    {/* TABLE */}
                    <div className="am-table-card">
                        <div className="am-table-header">
                            <h3>Recent Audited Incident Closures</h3>
                            <button className="am-view-all-btn">View All Records</button>
                        </div>
                        <div className="am-table-wrap">
                            <table className="am-table">
                                <thead>
                                    <tr>
                                        <th>Incident ID</th>
                                        <th>Analyst</th>
                                        <th>Resolution</th>
                                        <th>Duration</th>
                                        <th>Audit Status</th>
                                        <th>Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(Array.isArray(auditClosures) ? auditClosures : []).map((row) => {
                                        const s = statusConfig[row.status] || statusConfig.verified;
                                        return (
                                            <tr
                                                key={`closure-${row.incidentId}`}
                                                onClick={() => navigate("/incident", { state: { incidentId: row.incidentId } })}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <td className="am-incident-id">{row.id}</td>
                                                <td>{row.analyst}</td>
                                                <td className="am-resolution">{row.resolution}</td>
                                                <td>{row.duration}</td>
                                                <td>
                                                    <span className={`am-status-badge ${s.cls}`}>
                                                        {s.icon}{s.label}
                                                    </span>
                                                </td>
                                                <td className="am-details">{row.details}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </main>
        </div>
        );
    } catch (e) {
        console.error(e);
        page = <div className="am-page"><main className="am-main"><p style={{ padding: 24 }}>No data available</p></main></div>;
    }
    return page;
}
