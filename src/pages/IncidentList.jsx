import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
    Search, Bell, Settings, LayoutDashboard, AlertTriangle,
    ChevronRight, Shield, TrendingUp, Clock
} from "lucide-react";
import "../styles/incidents.css";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import { canMutate, getCurrentUser, logoutSession } from "../session";
import { formatTime } from "../utils/formatTime";
import { getIncidents } from "../platformStore";

export default function IncidentList() {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [storeTick, setStoreTick] = useState(0);

    const incidents = useMemo(() => {
        return getIncidents();
    }, [storeTick]);

    useEffect(() => {
        const onPlatformData = () => setStoreTick((tick) => tick + 1);
        window.addEventListener("soc_platform_data", onPlatformData);
        return () => window.removeEventListener("soc_platform_data", onPlatformData);
    }, []);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    const filteredIncidents = useMemo(() => {
        if (!searchTerm.trim()) return incidents;
        const term = searchTerm.toLowerCase();
        return incidents.filter((inc) =>
            inc.ip.includes(term) ||
            inc.id.toLowerCase().includes(term) ||
            inc.severity.toLowerCase().includes(term)
        );
    }, [incidents, searchTerm]);

    const sortedIncidents = useMemo(() => {
        const reviewOrder = { auto: 0, review: 1 };
        return [...filteredIncidents].sort((a, b) => {
            const aOrder = reviewOrder[a.reviewStatus] ?? Number.MAX_SAFE_INTEGER;
            const bOrder = reviewOrder[b.reviewStatus] ?? Number.MAX_SAFE_INTEGER;
            if (aOrder !== bOrder) return aOrder - bOrder;
            const aScore = Number.isFinite(Number(a?.correlationScore)) ? Number(a.correlationScore) : 0;
            const bScore = Number.isFinite(Number(b?.correlationScore)) ? Number(b.correlationScore) : 0;
            if (aScore !== bScore) return bScore - aScore;
            const severityOrder = { critical: 3, high: 2, medium: 1, low: 0 };
            return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
        });
    }, [filteredIncidents]);

    const getSourceCount = (incident) => {
        const sources = new Set(incident.alerts.map((a) => a.source));
        return sources.size;
    };

    const getStages = (incident) => {
        const stages = new Set();
        incident.alerts.forEach((a) => {
            const text = `${a.desc || ""} ${a.sub || ""} ${a.type || ""}`.toLowerCase();
            if (text.includes("scan") || text.includes("recon")) stages.add("Recon");
            if (text.includes("ssh") || text.includes("login") || text.includes("brute")) stages.add("Access");
            if (text.includes("injection") || text.includes("process")) stages.add("Execution");
            if (text.includes("network") || text.includes("dns") || text.includes("traffic") || text.includes("c2")) stages.add("C2");
        });
        return Array.from(stages);
    };

    const handleIncidentClick = (incident) => {
        navigate(`/incident/${incident.id}`);
    };

    const getReviewBadge = (incident) => {
        const reviewStatus = incident?.reviewStatus === "auto" ? "auto" : "review";
        if (reviewStatus === "auto") return { color: "red", label: "AUTO" };
        return { color: "blue", label: "REVIEW" };
    };

    const getSeverityIcon = (severity) => {
        if (severity === "critical" || severity === "high") return <AlertTriangle size={16} className="severity-icon critical" />;
        return <TrendingUp size={16} className="severity-icon" />;
    };

    return (
        <div className="incidents-page">
            {/* TOPBAR */}
            <header className="incidents-topbar">
                <div className="incidents-topbar-left">
                    <div className="incidents-logo"><SocLogo /></div>
                    {(() => {
                        const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
                        const roleType = (user.roleType || "analyst").toLowerCase();
                        return (
                            <nav className="incidents-topnav">
                                <NavLink to="/dashboard">Dashboard</NavLink>
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/alerts">Alerts</NavLink>}
                                <NavLink to="/incidents" className="active">Incidents</NavLink>
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/intelligence">Intelligence</NavLink>}
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/cases">Cases</NavLink>}
                                {roleType === "admin" && <NavLink to="/audit">Audit &amp; Metrics</NavLink>}
                                {roleType === "admin" && <NavLink to="/settings">Settings</NavLink>}
                            </nav>
                        );
                    })()}
                </div>
                <div className="incidents-topbar-right">
                    <div className="incidents-search">
                        <Search size={16} />
                        <input placeholder="Search incidents..." />
                    </div>
                    <div className="incidents-icon-btns">
                        <HeaderNotificationBell className="incidents-icon-btn"><Bell size={18} /></HeaderNotificationBell>
                        <HeaderSettingsNav className="incidents-icon-btn"><Settings size={18} /></HeaderSettingsNav>
                    </div>
                    <HeaderMenuAvatar className="incidents-avatar" onLogout={() => { logoutSession(); navigate("/"); }} />
                </div>
            </header>

            {/* MAIN CONTENT */}
            <div className="incidents-body">
                <div className="incidents-container">
                    {/* HEADER */}
                    <div className="incidents-header">
                        <div className="incidents-header-left">
                            <h1>Incidents</h1>
                            <p>All detected incidents grouped by source IP</p>
                        </div>
                        <div className="incidents-header-stats">
                            <div className="incidents-stat">
                                <span className="stat-label">Total</span>
                                <span className="stat-value">{incidents.length}</span>
                            </div>
                            <div className="incidents-stat">
                                <span className="stat-label">Auto-Escalated</span>
                                <span className="stat-value">{incidents.filter((i) => Number(i?.correlationScore) >= 90).length}</span>
                            </div>
                            <div className="incidents-stat">
                                <span className="stat-label">Needs Review</span>
                                <span className="stat-value">{incidents.filter((i) => Number(i?.correlationScore) < 90).length}</span>
                            </div>
                        </div>
                    </div>

                    {/* SEARCH */}
                    <div className="incidents-search-bar">
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder="Search by IP, ID, or severity..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {/* INCIDENTS LIST */}
                    <div className="incidents-list">
                        {sortedIncidents.length === 0 ? (
                            <div className="incidents-empty">
                                <Shield size={48} />
                                <h3>No incidents found</h3>
                                <p>{searchTerm ? "Try adjusting your search" : "All systems normal"}</p>
                            </div>
                        ) : (
                            <div className="incidents-table-wrap">
                                <div className="incidents-table">
                                    <div className="incidents-table-header">
                                        <div className="incidents-col-ip">IP Address</div>
                                        <div className="incidents-col-id">Incident ID</div>
                                        <div className="incidents-col-count">Alerts</div>
                                        <div className="incidents-col-sources">Sources</div>
                                        <div className="incidents-col-severity">Severity</div>
                                        <div className="incidents-col-score">Score</div>
                                        <div className="incidents-col-status">Status</div>
                                    </div>
                                    {sortedIncidents.slice((currentPage - 1) * 10, currentPage * 10).map((incident) => {
                                        const sourceCount = getSourceCount(incident);
                                        const stages = getStages(incident);
                                        const correlationScore = Number.isFinite(Number(incident?.correlationScore))
                                            ? Math.max(0, Math.min(100, Math.round(Number(incident.correlationScore))))
                                            : 0;
                                        const reviewBadge = getReviewBadge(incident);
                                        return (
                                            <div
                                                key={incident.id}
                                                className={`incidents-table-row severity-${incident.severity}`}
                                                onClick={() => handleIncidentClick(incident)}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => e.key === "Enter" && handleIncidentClick(incident)}
                                            >
                                                <div className="incidents-col-ip">
                                                    <span className="incidents-ip-badge">{incident.ip}</span>
                                                </div>
                                                <div className="incidents-col-id">
                                                    <span className="incidents-id">{incident.id}</span>
                                                </div>
                                                <div className="incidents-col-count">
                                                    <span className="incidents-count">{Array.isArray(incident.alerts) ? incident.alerts.length : 0}</span>
                                                </div>
                                                <div className="incidents-col-sources">
                                                    <span className="incidents-count">{sourceCount}</span>
                                                </div>
                                                <div className="incidents-col-severity">
                                                    <div className="incidents-severity">
                                                        {getSeverityIcon(incident.severity)}
                                                        <span className={`incidents-severity-text ${incident.severity}`}>
                                                            {incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1)}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="incidents-col-score">
                                                    <div className="incidents-score-bar">
                                                        <div
                                                            className="incidents-score-fill"
                                                            style={{
                                                                width: `${correlationScore}%`,
                                                                background: correlationScore >= 90 ? "#ef4444" : correlationScore >= 70 ? "#f59e0b" : "#3b82f6"
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="incidents-score-text">{correlationScore}/100</span>
                                                </div>
                                                <div className="incidents-col-status">
                                                    <span className={`incidents-badge badge-${reviewBadge.color}`}>
                                                        {reviewBadge.label}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {sortedIncidents.length > 10 && (
                                    <div className="incidents-pagination" style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        padding: "16px 24px",
                                        borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                                        background: "rgba(255, 255, 255, 0.01)",
                                        fontSize: "13px",
                                        color: "#94a3b8"
                                    }}>
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            style={{
                                                background: "rgba(59, 130, 246, 0.1)",
                                                border: "1px solid rgba(59, 130, 246, 0.2)",
                                                borderRadius: "4px",
                                                color: currentPage === 1 ? "rgba(255, 255, 255, 0.15)" : "#3b82f6",
                                                cursor: currentPage === 1 ? "not-allowed" : "pointer",
                                                padding: "6px 12px",
                                                fontWeight: "600",
                                                transition: "all 0.2s"
                                            }}
                                        >
                                            &larr; Previous
                                        </button>
                                        <span style={{ fontWeight: "500", fontFamily: "monospace" }}>
                                            Page {currentPage} of {Math.ceil(sortedIncidents.length / 10)}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage(p => Math.min(Math.ceil(sortedIncidents.length / 10), p + 1))}
                                            disabled={currentPage === Math.ceil(sortedIncidents.length / 10)}
                                            style={{
                                                background: "rgba(59, 130, 246, 0.1)",
                                                border: "1px solid rgba(59, 130, 246, 0.2)",
                                                borderRadius: "4px",
                                                color: currentPage === Math.ceil(sortedIncidents.length / 10) ? "rgba(255, 255, 255, 0.15)" : "#3b82f6",
                                                cursor: currentPage === Math.ceil(sortedIncidents.length / 10) ? "not-allowed" : "pointer",
                                                padding: "6px 12px",
                                                fontWeight: "600",
                                                transition: "all 0.2s"
                                            }}
                                        >
                                            Next &rarr;
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
