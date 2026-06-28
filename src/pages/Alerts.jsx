import {
    Activity,
    Archive,
    Bell,
    Calendar,
    CheckCircle,
    ChevronDown,
    ChevronLeft, ChevronRight,
    Filter,
    History,
    MoreHorizontal,
    Cpu,
    Network,
    Loader2,
    RefreshCw,
    Search,
    Settings,
    Terminal,
    User
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Chart, registerables } from "chart.js";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import { canMutate, getCurrentUser, logoutSession, userDisplayName } from "../session";
import { formatTime } from "../utils/formatTime";
import {
    correlateAlerts,
    inferAlertActions,
    pushAudit,
    pushNotification,
    getIncidents,
    upsertIncident,
    syncWithBackend,
} from "../platformStore";
import { assignAlert, escalateAlert, getAlerts, getSeverityCounts, investigateAlert, updateAlert } from "../store/socStore";
import "../styles/Alerts.css";

const PAGE_SIZE = 10;

Chart.register(...registerables);

const iconForSource = {
    Wazuh: Terminal,
    Sysmon: Cpu,
    Suricata: Network,
    "Network ML": Network,
};

function attachIcons(alerts) {
    return alerts.map((a) => {
        const Icon = iconForSource[a.source] || Network;
        return {
            ...a,
            sourceIcon: <Icon size={13} />,
            actions: inferAlertActions(a),
        };
    });
}

function analyzeWithMLLocal(payload) {
    const t = `${payload?.desc || ""} ${payload?.type || ""}`.toLowerCase();
    if (t.includes("malicious") || t.includes("exploit") || t.includes("beacon") || t.includes("c2")) {
        return { prediction: "malicious_traffic", confidence: 0.78 };
    }
    if (t.includes("scan") || t.includes("failed") || t.includes("anomaly") || t.includes("suspicious")) {
        return { prediction: "network_anomaly", confidence: 0.71 };
    }
    return { prediction: "benign", confidence: 0.35 };
}

function alertTimeMs(alert) {
    const fallback = alert?.date && alert?.time ? `${alert.date}T${alert.time}` : "";
    const ms = Date.parse(alert?.createdAt || fallback || "");
    return Number.isFinite(ms) ? ms : 0;
}

function filterByWindow(list, window) {
    if (window === "all") return list;
    const now = Date.now();
    const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 0;
    if (!hours) return list;
    const cutoff = now - hours * 60 * 60 * 1000;
    return list.filter((alert) => {
        const ts = alertTimeMs(alert);
        // Include alerts with invalid/unparseable timestamps or very old timestamps (mock data)
        if (!ts || ts < 1700000000000) return true;
        return ts >= cutoff;
    });
}

function detectMitre(alert) {
    const text = `${alert.desc || ""} ${alert.sub || ""} ${alert.type || ""}`.toLowerCase();
    if (text.includes("scan") || text.includes("recon")) return { id: "T1046", name: "Network Service Scanning" };
    if (text.includes("ssh") || text.includes("login") || text.includes("brute")) return { id: "T1110", name: "Brute Force" };
    if (text.includes("injection") || text.includes("process")) return { id: "T1055", name: "Process Injection" };
    if (text.includes("dns") || text.includes("traffic") || text.includes("c2")) return { id: "T1071", name: "Application Layer Protocol" };
    return null;
}

function pctChange(cur, prev) {
    if (prev <= 0) return cur > 0 ? "+100%" : "0%";
    const value = Math.round(((cur - prev) / prev) * 100);
    return `${value >= 0 ? "+" : ""}${value}%`;
}

const severityConfig = {
    critical: { label: "Critical", cls: "sev-critical" },
    high: { label: "High", cls: "sev-high" },
    medium: { label: "Medium", cls: "sev-medium" },
    low: { label: "Low", cls: "sev-low" },
};

const statusConfig = {
    "new": { label: "New", dot: "dot-blue pulse", cls: "status-new" },
    "in-progress": { label: "In Progress", dot: "dot-orange", cls: "status-progress" },
    escalated: { label: "Escalated", dot: "dot-orange", cls: "status-progress" },
    "resolved": { label: "Resolved", dot: null, cls: "status-resolved", icon: <CheckCircle size={11} /> },
};

export default function Alerts({ view } = {}) {
    const navigate = useNavigate();
    const [search, setSearch] = useState("");
    const [hoveredId, setHoveredId] = useState(null);
    const [activeView, setActiveView] = useState(() => localStorage.getItem("alerts_activeView") || "all");
    const [masterAlerts, setMasterAlerts] = useState([]);
    const [loadingAlerts, setLoadingAlerts] = useState(false);
    const [alertsError, setAlertsError] = useState("");
    const [rowActionBusy, setRowActionBusy] = useState(null);
    const [sortBy, setSortBy] = useState(() => localStorage.getItem("alerts_sortBy") || "newest");

    const location = useLocation();
    const mode = view || (location.pathname === "/logs" ? "logs" : "alerts");

    // Pending filters (what user selects), applied filters (what table uses).
    const [pendingSource, setPendingSource] = useState(() => localStorage.getItem("alerts_pendingSource") || "all");
    const [pendingSeverity, setPendingSeverity] = useState(() => localStorage.getItem("alerts_pendingSeverity") || "all");
    const [pendingTime, setPendingTime] = useState(() => localStorage.getItem("alerts_pendingTime") || "all");
    const [appliedSource, setAppliedSource] = useState(() => localStorage.getItem("alerts_appliedSource") || "all");
    const [appliedSeverity, setAppliedSeverity] = useState(() => localStorage.getItem("alerts_appliedSeverity") || "all");
    const [appliedTime, setAppliedTime] = useState(() => localStorage.getItem("alerts_appliedTime") || "all");
    const [alertPage, setAlertPage] = useState(1);
    const [logPage, setLogPage] = useState(1);

    useEffect(() => {
        localStorage.setItem("alerts_activeView", activeView);
    }, [activeView]);

    useEffect(() => {
        localStorage.setItem("alerts_sortBy", sortBy);
    }, [sortBy]);

    useEffect(() => {
        localStorage.setItem("alerts_pendingSource", pendingSource);
    }, [pendingSource]);

    useEffect(() => {
        localStorage.setItem("alerts_pendingSeverity", pendingSeverity);
    }, [pendingSeverity]);

    useEffect(() => {
        localStorage.setItem("alerts_pendingTime", pendingTime);
    }, [pendingTime]);

    useEffect(() => {
        localStorage.setItem("alerts_appliedSource", appliedSource);
    }, [appliedSource]);

    useEffect(() => {
        localStorage.setItem("alerts_appliedSeverity", appliedSeverity);
    }, [appliedSeverity]);

    useEffect(() => {
        localStorage.setItem("alerts_appliedTime", appliedTime);
    }, [appliedTime]);



    const SOURCE_KEYS = useMemo(() => ["all", "Wazuh", "Sysmon", "Suricata", "Network ML"], []);
    const SEVERITY_KEYS = useMemo(() => ["all", "highcrit", "critical", "high", "medium", "low"], []);
    const TIME_KEYS = useMemo(() => ["24h", "7d", "all"], []);

    const cycle = (arr, val, setter) => {
        const idx = arr.indexOf(val);
        setter(arr[(idx + 1) % arr.length]);
    };

    const applyFilters = () => {
        setAppliedSource(pendingSource);
        setAppliedSeverity(pendingSeverity);
        setAppliedTime(pendingTime);
    };

    const alertAssignedToMe = (a) => {
        const u = getCurrentUser();
        const cu = userDisplayName(u).trim();
        const em = (u?.email || "").trim().toLowerCase();
        if (a.assignedTo === "CURRENT_USER") return true;
        if (!a.assignedTo) return false;
        const at = String(a.assignedTo).trim().toLowerCase();
        return at === cu.toLowerCase() || (!!em && at === em);
    };

    const filterByApplied = (list) => {
        let out = list;
        out = filterByWindow(out, appliedTime);
        const q = search.trim().toLowerCase();
        if (q.length > 1) {
            out = out.filter((a) => {
                const dst = a.dstIP ? String(a.dstIP) : "";
                return (
                    a.id.toLowerCase().includes(q) ||
                    (a.srcIP || "").toLowerCase().includes(q) ||
                    dst.includes(q) ||
                    (a.type || "").toLowerCase().includes(q) ||
                    (a.desc || "").toLowerCase().includes(q)
                );
            });
        }
        if (appliedSource !== "all") out = out.filter((a) => a.source === appliedSource);
        if (appliedSeverity === "highcrit") out = out.filter((a) => a.severity === "high" || a.severity === "critical");
        else if (appliedSeverity !== "all") {
            const normalized = appliedSeverity.toLowerCase();
            out = out.filter((a) => String(a.severity || "").toLowerCase() === normalized);
        }
        if (activeView === "assignments") {
            out = out.filter((a) => alertAssignedToMe(a));
        } else if (activeView === "archives") {
            out = out.filter((a) => String(a.status || "").toLowerCase() === "resolved");
        }
        return out;
    };

    const filteredLogs = useMemo(() => {
        let out = masterAlerts.map((alert) => ({
            id: alert.id,
            ts: `${alert.date || ""} ${alert.time || ""}`.trim() || formatTime(alert.createdAt || new Date()),
            source: alert.source,
            severity: alert.severity,
            message: alert.desc || alert.sub || alert.type || "SOC event",
        }));
        if (appliedSource !== "all") out = out.filter((l) => l.source === appliedSource);
        if (appliedSeverity === "highcrit") out = out.filter((l) => l.severity === "high" || l.severity === "critical");
        else if (appliedSeverity !== "all") {
            const normalized = appliedSeverity.toLowerCase();
            out = out.filter((l) => String(l.severity || "").toLowerCase() === normalized);
        }
        const q = search.trim().toLowerCase();
        if (q.length > 1) out = out.filter((l) => l.id.toLowerCase().includes(q) || l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q));
        const ln = out.length;
        if (appliedTime === "24h") out = out.slice(0, Math.max(0, Math.min(ln, Math.ceil(ln * 0.5))));
        else if (appliedTime === "7d") out = out.slice(0, Math.max(0, Math.min(ln, Math.ceil(ln * 0.75))));
        return out;
    }, [appliedSource, appliedSeverity, appliedTime, search, masterAlerts]);

    const tableAlertsAll = useMemo(
        () => {
            const filtered = filterByApplied(masterAlerts);
            const sorted = [...filtered];
            sorted.sort((a, b) => {
                const timeA = alertTimeMs(a);
                const timeB = alertTimeMs(b);
                if (sortBy === "oldest") {
                    return timeA - timeB;
                } else {
                    return timeB - timeA;
                }
            });
            console.log("SEARCH:", search);
            console.log("MASTER:", masterAlerts.length);
            console.log("TABLE:", sorted.length);
            return sorted;
        },
        [masterAlerts, search, appliedSource, appliedSeverity, appliedTime, activeView, sortBy]
    );
    const stats = useMemo(() => {
        // Use masterAlerts for counter statistics (full dataset)
        const totalCount = masterAlerts.length;
        const criticalCount = masterAlerts.filter((a) => a.severity === "critical").length;
        const highCount = masterAlerts.filter((a) => a.severity === "high").length;
        const pendingCount = masterAlerts.filter((a) => String(a?.status || "").toLowerCase() === "new").length;

        return [
            { label: "Total Alerts", value: totalCount.toLocaleString(), change: "+2.5%", changeColor: "green" },
            { label: "Critical", value: criticalCount.toLocaleString(), change: "+1", changeColor: "green", valueColor: "red" },
            { label: "High Severity", value: highCount.toLocaleString(), change: "+3", changeColor: "green", valueColor: "orange" },
            { label: "Pending Triage", value: pendingCount.toLocaleString(), change: "-1", changeColor: "red" },
        ];
    }, [masterAlerts]);
    const alertPageCount = Math.max(1, Math.ceil(tableAlertsAll.length / PAGE_SIZE));
    const tableAlertsPage = tableAlertsAll.slice((alertPage - 1) * PAGE_SIZE, alertPage * PAGE_SIZE);
    const logPageCount = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
    const logsPageRows = filteredLogs.slice((logPage - 1) * PAGE_SIZE, logPage * PAGE_SIZE);

    useEffect(() => {
        setAlertPage(1);
    }, [search, appliedSource, appliedSeverity, appliedTime, activeView, mode]);

    useEffect(() => {
        setLogPage(1);
    }, [search, appliedSource, appliedSeverity, appliedTime, mode]);

    useEffect(() => {
        setAlertPage((p) => Math.min(p, alertPageCount));
    }, [alertPageCount]);

    useEffect(() => {
        setLogPage((p) => Math.min(p, logPageCount));
    }, [logPageCount]);

    useEffect(() => {
        if (location.pathname === "/logs") {
            setActiveView("all");
        }
    }, [location.pathname]);

    useEffect(() => {
        const load = () => {
            try {
                const alerts = getAlerts();
                if (!alerts.length) console.error("NO ALERTS LOADED");
                const enriched = attachIcons(alerts || []);
                setMasterAlerts(enriched);
            } catch (e) {
                console.error(e);
            }
        };

        load();
        window.addEventListener("soc_platform_data", load);

        return () =>
            window.removeEventListener("soc_platform_data", load);
    }, []);

    const upsertAlert = (id, updater) => {
        setMasterAlerts((prev) => prev.map((a) => (a.id === id ? updater(a) : a)));
    };

    const doAssign = (alert) => {
        if (!canMutate()) return;
        const me = userDisplayName(getCurrentUser());
        assignAlert(alert.id, me);
        const currentStatus = String(alert.status || "").toLowerCase();
        const newStatus = currentStatus === "new" ? "in-progress" : alert.status;
        upsertAlert(alert.id, (a) => ({ ...a, assignedTo: me, status: newStatus }));
        pushAudit({ action: "assigned", entityType: "alert", entityId: alert.id, analyst: me, message: `Assigned to ${me}` });
        pushNotification(`Alert ${alert.id} assigned to ${me}`);
        window.dispatchEvent(new Event("soc_platform_data"));
    };

    const handleEscalate = (alert) => {
        if (!canMutate() || rowActionBusy) return;
        setRowActionBusy(`esc-${alert.id}`);
        const done = () => setTimeout(() => setRowActionBusy(null), 480);
        const res = escalateAlert(alert.id);
        if (!res?.incidentId) {
            pushNotification("Could not escalate this alert.");
            done();
            return;
        }
        pushAudit({ action: "escalate", entityType: "alert", entityId: alert.id, message: `Linked to incident ${res.incidentId}` });
        pushNotification(`Alert ${alert.id} escalated — incident ${res.incidentId}`);
        window.dispatchEvent(new Event("soc_platform_data"));
        navigate(`/incident/${res.incidentId}?alertId=${alert.id}`);
        done();
    };

    const doInvestigate = (alert) => {
        if (rowActionBusy) return;
        setRowActionBusy(`inv-${alert.id}`);
        const me = userDisplayName(getCurrentUser());
        const corr = alert.correlationId;
        investigateAlert(alert.id);
        const relatedAlerts = corr
            ? masterAlerts.filter((a) => a.correlationId === corr)
            : [alert];
        relatedAlerts.forEach((a) => {
            upsertAlert(a.id, (cur) => ({ ...cur, status: "in-progress" }));
        });
        const incidents = getIncidents();
        let incident = incidents.find((i) => Array.isArray(i.alertIds) && i.alertIds.includes(alert.id));
        if (!incident && srcIP) {
            incident = incidents.find((i) => i.ip === srcIP || i.sourceIP === srcIP);
        }
        if (incident) {
            const updated = { ...incident, status: "in-progress" };
            upsertIncident(updated);
        } else {
            const newInc = correlateAlerts(relatedAlerts);
            if (Array.isArray(newInc) && newInc.length > 0) {
                const created = { ...newInc[0], status: "in-progress" };
                upsertIncident(created);
                incident = created;
            }
        }
        pushAudit({ action: "investigating", entityType: "alert", entityId: alert.id, analyst: me, incidentId: incident?.id || "", message: "Investigation started" });
        window.dispatchEvent(new Event("soc_platform_data"));
        if (incident) {
            navigate(`/incident/${incident.id}?alertId=${alert.id}`);
        } else {
            navigate(`/incident?alertId=${alert.id}`);
        }
        setTimeout(() => setRowActionBusy(null), 480);
    };

    const doViewCase = (alert) => {
        const iid = alert?.incidentId;
        if (iid == null || String(iid).trim() === "") return;
        navigate(`/incident/${encodeURIComponent(String(iid))}?alertId=${encodeURIComponent(String(alert.id))}`);
    };

    const handleViewChange = (view) => {
        setActiveView(view);
    };

    const showAlertsPagination = mode === "alerts";
    const showLogsPagination = mode === "logs";
    const goAlertPrev = () => setAlertPage((p) => Math.max(1, p - 1));
    const goAlertNext = () => setAlertPage((p) => Math.min(alertPageCount, p + 1));
    const goLogPrev = () => setLogPage((p) => Math.max(1, p - 1));
    const goLogNext = () => setLogPage((p) => Math.min(logPageCount, p + 1));
    const topPagePrev = () => {
        if (showAlertsPagination) goAlertPrev();
        else if (showLogsPagination) goLogPrev();
    };
    const topPageNext = () => {
        if (showAlertsPagination) goAlertNext();
        else if (showLogsPagination) goLogNext();
    };
    const topPagePrevDisabled = showAlertsPagination ? alertPage <= 1 : showLogsPagination ? logPage <= 1 : true;
    const topPageNextDisabled = showAlertsPagination ? alertPage >= alertPageCount : showLogsPagination ? logPage >= logPageCount : true;

    return (
        <div className="al-page">

            {/* SIDEBAR */}
            <aside className="al-sidebar">
                <div className="al-sidebar-inner">
                    <div className="al-sidebar-brand">
                        <div className="al-brand-icon"><SocLogo showText={false} className="al-soc-logo" /></div>
                        <div>
                            <h1>Sentinel X</h1>
                            <p>SOC Operations</p>
                        </div>
                    </div>
                    <nav className="al-sidebar-nav">
                        <NavLink
                            to="/alerts"
                            end
                            className={({ isActive }) => `al-nav-item ${isActive ? "active" : ""}`}
                            onClick={() => { setActiveView("all"); }}
                        >
                            <Bell size={18} /><span>All Alerts</span>
                        </NavLink>
                        <button className="al-nav-item" onClick={() => handleViewChange("assignments")} style={{ background: activeView === "assignments" ? "rgba(255,255,255,0.1)" : "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", padding: "12px 16px", borderRadius: "8px", color: activeView === "assignments" ? "#2badee" : "rgba(255,255,255,0.6)" }}>
                            <User size={18} /><span>My Assignments</span>
                        </button>
                        <button className="al-nav-item" onClick={() => handleViewChange("archives")} style={{ background: activeView === "archives" ? "rgba(255,255,255,0.1)" : "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", padding: "12px 16px", borderRadius: "8px", color: activeView === "archives" ? "#2badee" : "rgba(255,255,255,0.6)" }}>
                            <Archive size={18} /><span>Archives</span>
                        </button>
                        <div className="al-divider" />
                        <NavLink to="/logs" className={({ isActive }) => `al-nav-item muted ${isActive ? "active" : ""}`}>
                            <History size={18} /><span>System Logs</span>
                        </NavLink>
                    </nav>
                    <div className="al-sidebar-footer">
                        <NavLink to="/settings" className="al-nav-item">
                            <Settings size={18} /><span>Settings</span>
                        </NavLink>
                        <div className="al-engine-status">
                            <div className="al-engine-header">
                                <span className="al-engine-dot" />
                                <span>Wazuh Engine Active</span>
                            </div>
                            <div className="al-engine-bar">
                                <div className="al-engine-fill" />
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* MAIN */}
            <main className="al-main">

                {/* TOPBAR */}
                <header className="al-topbar">

                    {/* LEFT: Title + Live */}
                    <div className="al-topbar-left">
                        <h2>Alert Triage Console</h2>
                        <div className="al-live-badge">
                            <RefreshCw size={11} /><span>Live</span>
                        </div>
                    </div>

                    {/* CENTER: Nav Links */}
                    {(() => {
                        const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
                        const roleType = (user.roleType || "analyst").toLowerCase();
                        return (
                            <nav className="al-topbar-nav">
                                <NavLink to="/dashboard">Dashboard</NavLink>
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/alerts">Alerts</NavLink>}
                                <NavLink to="/incidents">Incidents</NavLink>
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/intelligence">Intelligence</NavLink>}
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/cases">Cases</NavLink>}
                                {roleType === "admin" && <NavLink to="/audit">Audit & Metrics</NavLink>}
                                {roleType === "admin" && <NavLink to="/settings">Settings</NavLink>}
                            </nav>
                        );
                    })()}

                    {/* SEARCH */}
                    <div className="al-search-wrap">
                        <Search size={15} className="al-search-icon" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search Alert ID, IP, or Signature..."
                        />
                    </div>

                    {/* RIGHT */}
                    <div className="al-topbar-right">
                        <div className="al-notif-wrap">
                            <HeaderNotificationBell className="al-icon-btn" badgeClassName="al-notif-badge">
                                <Bell size={18} />
                            </HeaderNotificationBell>
                        </div>
                        <HeaderSettingsNav className="al-icon-btn">
                            <Settings size={18} />
                        </HeaderSettingsNav>
                        <HeaderMenuAvatar
                            className="al-avatar"
                            onLogout={() => { logoutSession(); navigate("/"); }}
                        />
                    </div>
                </header>

                {/* STATS */}
                <div className="al-stats-grid">
                    {stats.map((s, i) => (
                        <div key={`stat-${s.label}-${i}`} className="al-stat-card">
                            <div className="al-stat-top">
                                <p className="al-stat-label">{s.label}</p>
                                <span className={`al-stat-change change-${s.changeColor}`}>{s.change}</span>
                            </div>
                            <p className={`al-stat-value ${s.valueColor ? `value-${s.valueColor}` : ""}`}>{s.value}</p>
                        </div>
                    ))}
                </div>

                {/* FILTERS */}
                <div className="al-filters">
                    <div className="al-filters-left">
                        <button type="button" className="al-filter-btn" onClick={() => cycle(SOURCE_KEYS, pendingSource, setPendingSource)}>
                            Source: {pendingSource === "all" ? "All" : pendingSource} <ChevronDown size={13} />
                        </button>
                        <button type="button" className="al-filter-btn" onClick={() => cycle(SEVERITY_KEYS, pendingSeverity, setPendingSeverity)}>
                            Severity: {pendingSeverity === "all" ? "All" : pendingSeverity === "highcrit" ? "High/Crit" : pendingSeverity.charAt(0).toUpperCase() + pendingSeverity.slice(1)} <ChevronDown size={13} />
                        </button>
                        <button type="button" className="al-filter-btn" onClick={() => cycle(TIME_KEYS, pendingTime, setPendingTime)}>
                            Time: {pendingTime === "24h" ? "Last 24h" : pendingTime === "7d" ? "Last 7d" : "All"} <Calendar size={13} />
                        </button>
                        <button type="button" className="al-filter-btn" onClick={() => setSortBy(p => p === "newest" ? "oldest" : "newest")} style={{ color: "#2badee", border: "1px solid rgba(43, 173, 238, 0.4)" }}>
                            Sort: {sortBy === "newest" ? "Newest First" : "Oldest First"} <ChevronDown size={13} />
                        </button>
                        <div className="al-filter-divider" />
                        <button type="button" className="al-apply-btn" onClick={applyFilters}><Filter size={13} />Apply Filters</button>
                    </div>
                    <div className="al-filters-right">
                        {loadingAlerts && mode === "alerts" ? <p className="al-display-text">Loading alerts...</p> : null}
                        {alertsError && mode === "alerts" ? <p className="al-display-text">{alertsError}</p> : null}
                        <p className="al-display-text">
                            {mode === "logs"
                                ? `Displaying ${filteredLogs.length} of ${filteredLogs.length} log lines • Page ${logPage} of ${logPageCount}`
                                : `Displaying ${tableAlertsAll.length} alerts`}
                        </p>
                        <div className="al-pagination-btns">
                            <button type="button" className="al-page-btn" onClick={topPagePrev} disabled={topPagePrevDisabled}><ChevronLeft size={14} /></button>
                            <button type="button" className="al-page-btn" onClick={topPageNext} disabled={topPageNextDisabled}><ChevronRight size={14} /></button>
                        </div>
                    </div>
                </div>

                {/* TABLE / LOGS */}
                {mode === "logs" ? (
                    <div className="al-table-wrap">
                        <div className="al-table-scroll">
                            <table className="al-table">
                                <thead>
                                    <tr>
                                        <th>Log ID</th>
                                        <th>Timestamp</th>
                                        <th>Severity</th>
                                        <th>Source</th>
                                        <th>Message</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logsPageRows.length === 0 ? (
                                        <tr className="al-row"><td colSpan={5} className="al-td"><p className="al-desc">No data available</p></td></tr>
                                    ) : logsPageRows.map((log) => {
                                        const sev = severityConfig[log.severity];
                                        return (
                                            <tr key={log.id} className="al-row">
                                                <td className="al-td-id">{log.id}</td>
                                                <td className="al-td"><p className="al-date">{log.ts}</p></td>
                                                <td className="al-td"><span className={`al-severity ${sev.cls}`}>{sev.label}</span></td>
                                                <td className="al-td"><div className="al-source"><span>{log.source}</span></div></td>
                                                <td className="al-td"><p className="al-desc">{log.message}</p></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="al-pagination">
                            <button type="button" className="al-refresh-btn"><RefreshCw size={12} />Auto-refresh: 30s</button>
                            <div className="al-pagination-right">
                                <span>Page {logPage} of {logPageCount}</span>
                                <div className="al-page-btns">
                                    <button type="button" className="al-page-btn-text" onClick={topPagePrev} disabled={topPagePrevDisabled}>Previous</button>
                                    <button type="button" className="al-page-btn-text" onClick={topPageNext} disabled={topPageNextDisabled}>Next</button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="al-table-wrap">
                        <div className="al-table-scroll">
                            <table className="al-table">
                                <thead>
                                    <tr>
                                        <th>Alert ID</th>
                                        <th>Timestamp</th>
                                        <th>Severity</th>
                                        <th>Source</th>
                                        <th>Alert Type</th>
                                        <th>Rule Description</th>
                                        <th>IP Metadata</th>
                                        <th>Status</th>
                                        <th className="al-th-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableAlertsPage.length === 0 ? (
                                        <tr className="al-row"><td colSpan={9} className="al-td"><p className="al-desc">No data available</p></td></tr>
                                    ) : tableAlertsPage.map((alert) => {
                                        const sev = severityConfig[alert.severity];
                                        const sta = statusConfig[alert.status] || statusConfig["new"];
                                        const isHovered = hoveredId === alert.id;
                                        return (
                                            <tr
                                                key={alert.id}
                                                className={`al-row ${alert.faded ? "al-row-faded" : ""}`}
                                                onMouseEnter={() => setHoveredId(alert.id)}
                                                onMouseLeave={() => setHoveredId(null)}
                                            >
                                                <td className="al-td-id">{alert.id}</td>
                                                <td className="al-td">
                                                    <p className="al-date">{alert.date}</p>
                                                    <p className="al-time">{alert.time}{alert.timeAgo && ` (${alert.timeAgo})`}</p>
                                                </td>
                                                <td className="al-td">
                                                    <span className={`al-severity ${sev.cls}`}>{sev.label}</span>
                                                </td>
                                                <td className="al-td">
                                                    <div className="al-source">
                                                        {alert.sourceIcon}
                                                        <span>{alert.source}</span>
                                                    </div>
                                                </td>
                                                <td className="al-td al-type">{alert.type}</td>
                                                <td className="al-td">
                                                    <p className="al-desc">#{alert.id} — {alert.desc}</p>
                                                    <p className="al-sub">{alert.sub}</p>
                                                    {alert.rule?.level ? <p className="al-sub">Rule Level: {alert.rule.level}</p> : null}
                                                    {alert.ruleMatches?.length > 0 ? <p className="al-sub">Matched: {alert.ruleMatches.join(", ")}</p> : null}
                                                    {alert.mitre ? <p className="al-sub">MITRE: {alert.mitre.id} - {alert.mitre.name}</p> : null}
                                                </td>
                                                <td className="al-td">
                                                    <span className="al-ip">{alert.srcIP}</span>
                                                    {alert.dstIP && <>
                                                        <span className="al-ip-arrow">↓</span>
                                                        <span className="al-ip">{alert.dstIP}</span>
                                                    </>}
                                                    {alert.hostname ? <p className="al-ip-meta">{alert.hostname}</p> : null}
                                                </td>
                                                <td className="al-td">
                                                    <div className={`al-status ${sta.cls}`}>
                                                        {sta.icon ? sta.icon : <span className={`al-status-dot ${sta.dot}`} />}
                                                        <span>{sta.label}</span>
                                                    </div>
                                                    <span className="al-signal">Signal Only</span>
                                                </td>
                                                <td className="al-td al-td-right">
                                                    {isHovered ? (
                                                        <div className="al-actions">
                                                            {alert.actions.includes("assign") && <button type="button" className="al-btn-ghost" onClick={() => doAssign(alert)} disabled={!canMutate()}>Assign</button>}
                                                            {alert.actions.includes("escalate") && <button type="button" className="al-btn-danger" onClick={() => handleEscalate(alert)} disabled={!canMutate() || !!rowActionBusy} style={rowActionBusy === `esc-${alert.id}` ? { opacity: 0.65 } : undefined}>{rowActionBusy === `esc-${alert.id}` ? <Loader2 size={12} className="al-action-loader" /> : null}Escalate</button>}
                                                            {alert.actions.includes("investigate") && <button type="button" className="al-btn-primary" onClick={() => doInvestigate(alert)} disabled={!canMutate() || !!rowActionBusy} style={rowActionBusy === `inv-${alert.id}` ? { opacity: 0.65 } : undefined}>{rowActionBusy === `inv-${alert.id}` ? <Loader2 size={12} className="al-action-loader" /> : null}Investigate</button>}
                                                            {alert.actions.includes("investigate_only") && <button type="button" className="al-btn-primary" onClick={() => doInvestigate(alert)} disabled={!canMutate() || !!rowActionBusy} style={rowActionBusy === `inv-${alert.id}` ? { opacity: 0.65 } : undefined}>{rowActionBusy === `inv-${alert.id}` ? <Loader2 size={12} className="al-action-loader" /> : null}Investigate</button>}
                                                            {alert.actions.includes("view-case") && alert.incidentId != null && String(alert.incidentId).trim() !== "" && (
                                                                <button type="button" className="al-btn-ghost" onClick={() => doViewCase(alert)}>View Case</button>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="al-more"><MoreHorizontal size={16} /></span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* PAGINATION */}
                        <div className="al-pagination">
                            <button type="button" className="al-refresh-btn"><RefreshCw size={12} />Auto-refresh: 30s</button>
                            <div className="al-pagination-right">
                                <span>{showAlertsPagination ? `Page ${alertPage} of ${alertPageCount}` : showLogsPagination ? `Page ${logPage} of ${logPageCount}` : "—"}</span>
                                <div className="al-page-btns">
                                    <button type="button" className="al-page-btn-text" onClick={topPagePrev} disabled={topPagePrevDisabled}>Previous</button>
                                    <button type="button" className="al-page-btn-text" onClick={topPageNext} disabled={topPageNextDisabled}>Next</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </main>
        </div>
    );
}
