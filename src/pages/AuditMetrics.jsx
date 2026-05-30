import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Search, TrendingDown, TrendingUp, Minus, CheckCircle, Clock, AlertCircle, Bell, Settings, Loader } from "lucide-react";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import { logoutSession, getCurrentUser, userDisplayName } from "../session";
import { getBackendAuditLogs, getAuditMetrics, getIncidentsList, getCasesList } from "../api/socService";
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

function renderDetails(details) {
    if (!details) return "—";
    if (typeof details === "string") {
        const trimmed = details.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
                const parsed = JSON.parse(trimmed);
                return renderParsedDetails(parsed);
            } catch (e) {
                return details;
            }
        }
        return details;
    }
    if (typeof details === "object") {
        return renderParsedDetails(details);
    }
    return String(details);
}

function renderParsedDetails(obj) {
    if (!obj || typeof obj !== "object") return "—";
    const parts = [];
    if (obj.case_id || obj.caseId) {
        parts.push(`Case: ${obj.case_id || obj.caseId}`);
    }
    if (obj.severity) {
        parts.push(`Severity: ${String(obj.severity).toUpperCase()}`);
    }
    if (obj.score || obj.correlation_score) {
        parts.push(`Score: ${obj.score || obj.correlation_score}`);
    }
    if (obj.classification) {
        parts.push(`Class: ${obj.classification}`);
    }
    if (obj.analyst) {
        parts.push(`Analyst: ${obj.analyst}`);
    }
    if (parts.length === 0) {
        return Object.entries(obj)
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(" • ");
    }
    return parts.join(" • ");
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
function LineChartComp({ trendData }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return undefined;

        const labels = trendData ? Object.keys(trendData) : [];
        const dataPoints = trendData ? Object.values(trendData) : [];

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
                    pointRadius: 3,
                    pointBackgroundColor: "#2badee"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: true } },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: "#92b7c9", font: { size: 9 } }
                    },
                    y: {
                        grid: { color: "rgba(146,183,201,0.1)" },
                        ticks: { color: "#92b7c9", font: { size: 9 } }
                    }
                }
            }
        });
        return () => chart.destroy();
    }, [trendData]);
    return <canvas ref={ref} />;
}

function BarChartComp({ workloadData }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return undefined;

        const labels = Array.isArray(workloadData) ? workloadData.map(w => w.analyst || "Unassigned") : [];
        const data = Array.isArray(workloadData) ? workloadData.map(w => w.cases_assigned) : [];

        const topLabelsPlugin = {
            id: "topLabels",
            afterDatasetsDraw(chart) {
                const { ctx, data } = chart;
                const colors = ["#92b7c9", "#2badee", "#92b7c9", "#92b7c9", "#92b7c9"];
                data.datasets[0].data.forEach((val, i) => {
                    const meta = chart.getDatasetMeta(0).data[i];
                    if (!meta) return;
                    ctx.save();
                    ctx.fillStyle = colors[i % colors.length];
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
                    backgroundColor: (Array.isArray(workloadData) ? workloadData : []).map((_, idx) => idx === 1 ? "#2badee" : "rgba(43,173,238,0.2)"),
                    borderRadius: 4,
                    borderSkipped: false,
                    barPercentage: 0.55,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 24 } },
                plugins: { legend: { display: false }, tooltip: { enabled: true } },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            color: (ctx) => ctx.index === 1 ? "#2badee" : "#92b7c9",
                            font: { size: 10, weight: "bold" },
                        }
                    },
                    y: { display: false }
                }
            },
            plugins: [topLabelsPlugin]
        });
        return () => chart.destroy();
    }, [workloadData]);
    return <canvas ref={ref} />;
}

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

    const [metrics, setMetrics] = useState(null);
    const [auditLogsList, setAuditLogsList] = useState([]);
    const [incidents, setIncidents] = useState([]);
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const onUpdate = () => setAuditTick((n) => n + 1);
        window.addEventListener("soc_audit_update", onUpdate);
        window.addEventListener("soc_platform_data", onUpdate);
        return () => {
            window.removeEventListener("soc_audit_update", onUpdate);
            window.removeEventListener("soc_platform_data", onUpdate);
        };
    }, []);

    useEffect(() => {
        let active = true;
        const fetchData = async () => {
            setLoading(true);
            try {
                const [metricsRes, auditRes, incidentsRes, casesRes] = await Promise.all([
                    getAuditMetrics({ range: timeRange }),
                    getBackendAuditLogs({ range: timeRange, limit: 100 }),
                    getIncidentsList({ limit: 100 }),
                    getCasesList({ limit: 100 }),
                ]);
                if (!active) return;
                setMetrics(metricsRes);
                setAuditLogsList(auditRes || []);
                setIncidents(incidentsRes || []);
                setCases(casesRes || []);
            } catch (err) {
                console.error("Failed to load audit metrics data:", err);
            } finally {
                if (active) setLoading(false);
            }
        };
        fetchData();
        return () => {
            active = false;
        };
    }, [timeRange, auditTick]);

    const displayStats = useMemo(() => {
        if (!metrics) return [];
        const alertVolume = Object.values(metrics.alert_volume_trend || {}).reduce((a, b) => a + b, 0);
        
        const fpIncidents = incidents.filter(i => i.classification === 'false_positive');
        const fpRate = incidents.length > 0 ? Math.round((fpIncidents.length / incidents.length) * 100) : 10;
        
        const tpIncidents = incidents.filter(i => i.classification === 'true_positive');
        const efficacy = incidents.length > 0 ? Math.round((tpIncidents.length / incidents.length) * 100) : 85;

        return [
            {
                label: "Avg MTTR",
                value: metrics.mttr_minutes > 0 ? formatDuration(metrics.mttr_minutes * 60 * 1000) : "—",
                change: "0%",
                trend: "neutral",
                barColor: "#fa5f38",
                barWidth: metrics.mttr_minutes > 0 ? `${Math.min(100, (metrics.mttr_minutes / 240) * 100)}%` : "0%",
            },
            {
                label: "Alert Volume",
                value: alertVolume.toLocaleString(),
                change: "0%",
                trend: "neutral",
                barColor: "#2badee",
                barWidth: `${Math.min(100, (alertVolume / 500) * 100)}%`,
            },
            {
                label: "False Positive Rate",
                value: `${fpRate}%`,
                change: "0%",
                trend: "neutral",
                barColor: "#facc15",
                barWidth: `${fpRate}%`,
            },
            {
                label: "Detection Efficacy",
                value: `${efficacy}%`,
                change: "0%",
                trend: "neutral",
                barColor: "#0bda57",
                barWidth: `${efficacy}%`,
            },
        ];
    }, [metrics, incidents]);

    const realAuditRows = useMemo(() => {
        const entries = Array.isArray(auditLogsList) ? auditLogsList : [];
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
            const t = Date.parse(e.created_at);
            let bucket = "30d";
            if (Number.isFinite(t)) {
                const age = Date.now() - t;
                const day = 24 * 60 * 60 * 1000;
                if (age <= day) bucket = "24h";
                else if (age <= 7 * day) bucket = "7d";
            }
            let duration = "—";
            if (e.entity_id && e.entity_type === 'incident') {
                const inc = incidents.find((i) => String(i.id) === String(e.entity_id));
                if (inc?.closed_at && inc?.created_at) {
                    const ms = Date.parse(inc.closed_at) - Date.parse(inc.created_at);
                    if (Number.isFinite(ms) && ms > 0) {
                        duration = formatDuration(ms);
                    }
                }
            }
            const base = `${e.action || "Action"} — ${e.message || ""}`.trim();
            const timePart = e.created_at && Number.isFinite(t) ? ` · ${formatTime(e.created_at)}` : "";
            return {
                id: e.entity_id ? `#${e.entity_id}` : `#AUD-${e.id || idx + 1}`,
                analyst: e.user?.name || "SOC User",
                role: "Analyst",
                action: e.action || "unknown",
                resolution: `${base}${timePart}`,
                duration,
                status: statusMap[e.action] || "verified",
                bucket,
                timestamp: e.created_at,
                details: e.details ? (typeof e.details === 'object' ? JSON.stringify(e.details) : e.details) : "",
                incidentId: e.entity_type === 'incident' || e.entity_type === 'case' ? e.entity_id : null
            };
        });
    }, [auditLogsList, incidents]);

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
        const resolved = incidents
            .filter((i) => (i.status === "resolved" || i.status === "closed") && i.closed_at && i.created_at)
            .sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at))
            .slice(0, 10);

        if (resolved.length === 0) {
            const closedCases = cases
                .filter((c) => c.status === "closed")
                .sort((a, b) => Date.parse(b.closed_at || b.created_at) - Date.parse(a.closed_at || a.created_at))
                .slice(0, 10);

            return closedCases.map((caseItem) => {
                const ms = caseItem.closed_at && caseItem.created_at
                    ? Date.parse(caseItem.closed_at) - Date.parse(caseItem.created_at)
                    : 0;
                const duration = Number.isFinite(ms) && ms > 0 ? formatDuration(ms) : "—";

                const latestAudit = auditLogsList.find(log => String(log.entity_id) === String(caseItem.id));
                const resolution = latestAudit ? `${latestAudit.action} — ${latestAudit.message}` : "Case Closed";
                const details = latestAudit ? (typeof latestAudit.details === 'object' ? JSON.stringify(latestAudit.details) : latestAudit.details) : "";
                const status = latestAudit?.action === 'escalate_case' ? 'flagged' : 'verified';
                const analyst = latestAudit?.user?.name || caseItem.assigned_to || "SOC Analyst";

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
            const ms = Date.parse(incident.closed_at) - Date.parse(incident.created_at);
            const duration = Number.isFinite(ms) && ms > 0 ? formatDuration(ms) : "—";

            const latestAudit = auditLogsList.find(log => String(log.entity_id) === String(incident.id));
            const resolution = latestAudit ? `${latestAudit.action} — ${latestAudit.message}` : incident.resolution || "Incident Resolved";
            const details = latestAudit ? (typeof latestAudit.details === 'object' ? JSON.stringify(latestAudit.details) : latestAudit.details) : incident.classification || "";
            const status = latestAudit?.action === 'escalate' ? 'flagged' : 'verified';
            const analyst = latestAudit?.user?.name || incident.resolved_by || "SOC Analyst";

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
    }, [incidents, cases, auditLogsList]);

    if (loading) {
        return (
            <div className="am-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0b1319' }}>
                <Loader size={32} style={{ animation: "spin 1s linear infinite", color: '#2badee' }} />
            </div>
        );
    }

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
                        {(() => {
                            const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
                            const roleType = (user.roleType || "analyst").toLowerCase();
                            return (
                                <nav className="am-nav">
                                    <NavLink to="/dashboard">Dashboard</NavLink>
                                    {(roleType === "admin" || roleType === "analyst") && <NavLink to="/alerts">Alerts</NavLink>}
                                    <NavLink to="/incidents">Incidents</NavLink>
                                    {(roleType === "admin" || roleType === "analyst") && <NavLink to="/intelligence">Intelligence</NavLink>}
                                    {(roleType === "admin" || roleType === "analyst") && <NavLink to="/cases">Cases</NavLink>}
                                    {roleType === "admin" && <NavLink to="/audit" className="active">Audit &amp; Metrics</NavLink>}
                                    {roleType === "admin" && <NavLink to="/settings">Settings</NavLink>}
                                </nav>
                            );
                        })()}
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
                                <p className="am-last-update">Last updated: Just now</p>
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
                                    <span className="am-mttr-display">
                                        {metrics?.mttr_minutes > 0 ? formatDuration(metrics.mttr_minutes * 60 * 1000) : "—"}
                                    </span>
                                    <span className="am-mttr-count">
                                        {metrics?.resolution_rate}% resolution rate
                                    </span>
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
                                        <span className="am-chart-avg">
                                            {metrics?.mttr_minutes > 0 ? formatDuration(metrics.mttr_minutes * 60 * 1000) : "—"} Avg
                                        </span>
                                        <span className="am-trend-neutral">
                                            0% vs last period
                                        </span>
                                    </div>
                                </div>
                                <div className="am-line-chart-wrap">
                                    <LineChartComp trendData={metrics?.alert_volume_trend} />
                                </div>
                            </div>

                            <div className="am-chart-card">
                                <div className="am-chart-header">
                                    <div>
                                        <h3>Analyst Workload Distribution</h3>
                                        <p>Alerts processed per responder</p>
                                    </div>
                                    <div className="am-chart-summary">
                                        <span className="am-chart-avg">
                                            {metrics?.analyst_workload?.length > 0 
                                                ? Math.round(metrics.analyst_workload.reduce((sum, w) => sum + w.cases_assigned, 0) / metrics.analyst_workload.length) 
                                                : 0} avg
                                        </span>
                                        <span className="am-trend-neutral">
                                            +0% vs last period
                                        </span>
                                    </div>
                                </div>
                                <div className="am-bar-chart-wrap">
                                    <BarChartComp workloadData={metrics?.analyst_workload} />
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
                                        {(Array.isArray(auditClosures) ? auditClosures : []).map((row, idx) => {
                                            const s = statusConfig[row.status] || statusConfig.verified;
                                            return (
                                                <tr
                                                    key={`closure-${row.incidentId || idx}`}
                                                    onClick={() => row.incidentId && navigate("/incidents")}
                                                    style={{ cursor: row.incidentId ? "pointer" : "default" }}
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
                                                    <td className="am-details">{renderDetails(row.details)}</td>
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
