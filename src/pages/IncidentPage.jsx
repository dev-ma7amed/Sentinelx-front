import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import {
    Search, Bell, Settings, LayoutDashboard, History,
    UserPlus, GitBranch, CheckCircle, Terminal, Cpu, Network,
    Laptop, User, MoveRight
} from "lucide-react";
import "../styles/IncidentPage.css";

import ClassifyModal from "../components/Alerts/ClassifyModal";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import { canMutate, getCurrentUser, logoutSession, userDisplayName } from "../session";
import { formatTime } from "../utils/formatTime";
import {
    createCaseFromIncident,
    getCases,
    getIncidents,
    hydrateSocPipeline,
    pushAudit,
    pushNotification,
    setCases,
    updateIncidentStatusOnAssign,
    upsertIncident,
    addIncidentAuditLog,
    getIncidentAuditLogsByIncidentId,
    logAction,
    executeUnifiedAction,
} from "../platformStore";
import { getAlerts, updateAlert } from "../store/socStore";
import { classifyIncident } from "../utils/incidentWorkflow";

// ── Stage detection ────────────────────────────────────────────────────────────
function detectStage(a) {
    const text = `${a.desc || ""} ${a.sub || ""} ${a.type || ""}`.toLowerCase();
    if (text.includes("scan") || text.includes("recon")) return "Recon";
    if (text.includes("ssh") || text.includes("login") || text.includes("brute")) return "Access";
    if (text.includes("injection") || text.includes("process")) return "Execution";
    if (text.includes("network") || text.includes("dns") || text.includes("traffic") || text.includes("c2")) return "C2";
    return "Unknown";
}

const NETWORK_TYPES = new Set(["network flow", "network ids", "malicious traffic"]);

function isNetworkAlert(a) {
    return (a.srcIP || a.dstIP) && NETWORK_TYPES.has(String(a.type || "").toLowerCase());
}

function getStatusBadgeColor(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "open") return "blue";
    if (normalized === "closed") return "gray";
    return "blue";
}

function getReviewBadge(reviewStatus, incidentStatus) {
    const isClosed = String(incidentStatus || "").toLowerCase() === "closed";
    if (isClosed) {
        return { color: "gray", label: "COMPLETED", detail: "Review Completed" };
    }
    return reviewStatus === "auto"
        ? { color: "red", label: "AUTO", detail: "Auto-Escalated" }
        : { color: "blue", label: "REVIEW", detail: "Needs Review" };
}

function classificationLabel(c) {
    const v = String(c || "").toLowerCase();
    if (v === "true_positive") return "True Positive";
    if (v === "false_positive") return "False Positive";
    if (v === "duplicate") return "Duplicate";
    return String(c || "").replace(/_/g, " ") || "—";
}

export default function IncidentPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams();
    const alertId = new URLSearchParams(location.search).get("alertId");
    const [note, setNote] = useState("");
    const [activeTab, setActiveTab] = useState("timeline");
    const [timelineItems, setTimelineItems] = useState([]);

    const meName = userDisplayName(getCurrentUser());
    const [assignedTo, setAssignedTo] = useState("Unassigned");
    const [incidentStatus, setIncidentStatus] = useState("Open");

    const [classifyOpen, setClassifyOpen] = useState(false);
    const [classifyInitial, setClassifyInitial] = useState("tp");

    const [scanBusy, setScanBusy] = useState(false);
    const [filterSource, setFilterSource] = useState("all");
    const [scanResult, setScanResult] = useState(null);
    const [ctxNav, setCtxNav] = useState("overview");
    const [noteBusy, setNoteBusy] = useState(false);
    const [escalateBusy, setEscalateBusy] = useState(false);
    const [storeTick, setStoreTick] = useState(0);
    const assignOnceRef = useRef(false);
    const hydrateRetryRef = useRef(false);
    const scanTimerRef = useRef(null);
    const autoEscalateRef = useRef(false);
    const sourceAlert = location.state?.alertId || null;
    const [incident, setIncident] = useState(null);
    const incidents = useMemo(() => getIncidents(), [storeTick]);

    const relatedAlerts = useMemo(() => (incident?.alerts || []), [incident]);
    const baseAlert = useMemo(() => {
        if (!alertId) return null;
        const fromRelated = relatedAlerts.find((a) => a.id === alertId) || null;
        if (fromRelated) return fromRelated;
        const all = getAlerts();
        return all.find((a) => a.id === alertId) || null;
    }, [alertId, relatedAlerts]);
    const ip = incident?.ip || baseAlert?.srcIP || "";
    const assignedToDisplay = incident?.owner || incident?.assignedTo || assignedTo;
    const incidentStatusValue = String(incident?.status || incidentStatus || "open").trim().toLowerCase();
    const correlationScore = incident?.correlationScore || 0;
    const reviewBadge = getReviewBadge(incident?.reviewStatus, incident?.status);

    // MOVE linkedCase BEFORE incidentStatusDisplay to prevent crash
    const linkedCase = useMemo(() => {
        if (!incident?.id) return null;
        const caseId = incident.caseId;
        if (!caseId) return null;
        const cases = getCases();
        return cases.find((c) => c.id === caseId) || null;
    }, [incident?.caseId, storeTick]);

    // Determine display status based on incident and case state
    let incidentStatusDisplay = "OPEN";
    let statusBadgeStyle = {};

    // Check incident's own status first
    const incidentOwnStatus = String(incident?.status || "").toLowerCase();
    if (incidentOwnStatus === "closed") {
        incidentStatusDisplay = "CLOSED";
        statusBadgeStyle = { color: "#94a3b8", fontWeight: 600 };
    } else if (linkedCase) {
        if (String(linkedCase.status || "").toLowerCase() === "closed") {
            incidentStatusDisplay = "RESOLVED";
        } else {
            // Case is open/triage - show as escalated
            incidentStatusDisplay = "ESCALATED";
        }
    } else {
        // Check if auto-escalated (score >= 90 or critical severity)
        const score = incident?.correlationScore || 0;
        const severity = String(incident?.severity || "").toLowerCase();
        const isAutoEscalatable = score >= 90 || severity === "critical";

        if (isAutoEscalatable) {
            incidentStatusDisplay = "OPEN — AUTO ESCALATED";
            statusBadgeStyle = { color: "#fa5f38", fontWeight: 600 };
        } else {
            incidentStatusDisplay = "OPEN — Awaiting Analyst Decision";
            statusBadgeStyle = { color: "#2badee", fontWeight: 600 };
        }
    }

    const incidentAuditLogs = useMemo(() => {
        try {
            const safeIncidentId = incident?.id || null;
            if (!safeIncidentId) return [];
            const logs = getIncidentAuditLogsByIncidentId(safeIncidentId);
            return Array.isArray(logs) ? logs : [];
        } catch (error) {
            console.error("Error loading incident audit logs:", error);
            return [];
        }
    }, [incident?.id, storeTick]);

    useEffect(() => {
        const onPlatformData = () => setStoreTick((tick) => tick + 1);
        window.addEventListener("soc_platform_data", onPlatformData);
        return () => window.removeEventListener("soc_platform_data", onPlatformData);
    }, []);

    useEffect(() => {
        const list = Array.isArray(incidents) ? incidents : [];
        console.log("INCIDENTS:", list);
        console.log("SCENARIO COUNT:", list.length);
        const fromAlert = alertId || sourceAlert;
        // Priority 1: Find by alertId (query parameter)
        if (fromAlert) {
            const foundByAlert = list.find((row) => Array.isArray(row.alertIds) && row.alertIds.includes(fromAlert));
            if (foundByAlert) {
                setIncident(foundByAlert);
                return;
            }
        }
        // Priority 2: Find by URL parameter id
        const fromState = location.state?.incidentId || location.state?.id || null;
        const targetId = id || fromState || null;
        let found = targetId ? list.find((row) => row.id === targetId) : null;
        if (!found && sourceAlert) found = list.find((row) => row.alertIds?.includes?.(sourceAlert)) || null;
        if (!found) {
            const hasLookupTarget = Boolean(fromAlert || targetId);
            if (hasLookupTarget && !hydrateRetryRef.current) {
                hydrateRetryRef.current = true;
                hydrateSocPipeline();
                setStoreTick((tick) => tick + 1);
                return;
            }
            if (hasLookupTarget && hydrateRetryRef.current) {
                navigate("/incidents", { replace: true });
                return;
            }
        } else {
            hydrateRetryRef.current = false;
        }
        setIncident(found || null);
    }, [alertId, id, incidents, location.state, navigate, sourceAlert]);

    // ── Timeline build ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!incident) { setTimelineItems([]); return; }
        const next = relatedAlerts
            .slice()
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .map((a) => {
                const stage = detectStage(a);
                const color = a.severity === "critical" ? "red" : a.severity === "high" ? "amber" : a.severity === "medium" ? "blue" : "gray";
                const icon = a.source === "Wazuh" ? <Terminal size={14} /> : a.source === "Sysmon" ? <Cpu size={14} /> : <Network size={14} />;
                return {
                    id: a.id,
                    title: a.desc,
                    badge: String(a.severity || "low").toUpperCase(),
                    badgeColor: a.severity === "critical" ? "red" : a.severity === "high" ? "amber" : "blue",
                    time: a.time || formatTime(a.createdAt || new Date()),
                    source: a.source,
                    severity: a.severity,
                    color, icon, stage,
                    srcIP: a.srcIP,
                    dstIP: a.dstIP,
                    sub: a.sub,
                    actions: a.source === "Network ML"
                        ? [{ label: "Investigate IP", primary: true }]
                        : a.source === "Wazuh" ? [{ label: "Inspect Logs" }]
                        : a.source === "Sysmon" ? [{ label: "Map Flow" }]
                        : [],
                };
            });
        setTimelineItems(next);
    }, [incident, relatedAlerts]);

    // ── Auto escalation + case creation ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!incident) return;
        if (incident.caseId) return;
        if (incident.escalated) return;
        if (autoEscalateRef.current) return;

        const score = incident.correlationScore || 0;
        const severity = String(incident.severity || "").toLowerCase();
        const shouldAutoEscalate = score >= 90 || severity === "critical";

        if (!shouldAutoEscalate) return;

        autoEscalateRef.current = true;

        const cases = getCases();
        const existingCase = cases.find((c) => c.incidentId === incident.id);
        if (existingCase) {
            const updated = { ...incident, caseId: existingCase.id, escalated: true };
            upsertIncident(updated);
            setIncident(updated);
            return;
        }

        const created = createCaseFromIncident(incident);
        if (created?.id) {
            const updated = {
                ...incident,
                autoEscalated: true,
                caseId: created.id,
                status: "open",
                escalated: true,
                classification: "Pending Review",
            };

            upsertIncident(updated);
            setIncident(updated);

            logAction("escalate_case", { incidentId: incident.id, caseId: created.id, analyst: "System", score, message: `Auto-escalated to case ${created.id}` });

            pushNotification(`Incident ${incident.id} auto-escalated (score: ${score}/100)`, { category: "incident" });
            pushNotification(`Case ${created.id} auto-created for incident ${incident.id}`, { category: "case" });

            pushAudit({
                action: "auto_escalate",
                entityType: "incident",
                entityId: incident.id,
                analyst: "System",
                message: `Auto-escalated and linked to case ${created.id} (score: ${score}/100)`
            });

            addIncidentAuditLog({
                type: "ESCALATED",
                incidentId: incident.id,
                caseId: created.id,
                analyst: "System",
                decision: "Auto-escalated"
            });

            window.dispatchEvent(new Event("soc_platform_data"));
        }
    }, [incident?.id]);

    // ── Derived intel ──────────────────────────────────────────────────────────
    const mitreTechniques = useMemo(() => {
        if (Array.isArray(incident?.mitre) && incident.mitre.length) {
            return [...new Set(incident.mitre)].slice(0, 3).map((id) => ({ id, name: id }));
        }
        const seen = new Set();
        const techniques = [];
        (relatedAlerts || []).forEach((a) => {
            if (a.mitre && !seen.has(a.mitre.id)) {
                seen.add(a.mitre.id);
                techniques.push(a.mitre);
            }
        });
        if (techniques.length) return techniques.slice(0, 3);
        const map = { "ssh": { id: "T1110", name: "Brute Force" }, "process": { id: "T1059", name: "Command and Scripting Interpreter" }, "traffic": { id: "T1071", name: "Application Layer Protocol" }, "scan": { id: "T1046", name: "Network Service Scanning" } };
        (relatedAlerts || []).forEach((a) => {
            const d = (a.ruleDescription || a.desc || "").toLowerCase();
            Object.entries(map).forEach(([k, v]) => {
                if (d.includes(k) && !seen.has(v.id)) { seen.add(v.id); techniques.push(v); }
            });
        });
        return techniques.slice(0, 3);
    }, [incident?.mitre, relatedAlerts]);

    const sourceSummary = useMemo(
        () => [...new Set((relatedAlerts || []).map((a) => a.source).filter(Boolean))],
        [relatedAlerts]
    );

    const stageBuckets = useMemo(() => {
        const stages = { Recon: [], Access: [], Execution: [], C2: [] };
        (relatedAlerts || []).forEach((a) => { const s = detectStage(a); if (stages[s]) stages[s].push(a); });
        return stages;
    }, [relatedAlerts]);

    const activeStages = useMemo(
        () => ["Recon", "Access", "Execution", "C2"].filter((s) => stageBuckets[s].length > 0),
        [stageBuckets]
    );

    const assignedToDisplay2 = assignedToDisplay;
    const ownerLabel = assignedToDisplay2.replace(/\s*\(You\)\s*$/i, "").trim();
    const displayName = assignedToDisplay2 !== "Unassigned" ? ownerLabel || assignedToDisplay2 : "John Doe";
    const initials = displayName.split(/\s+/).filter(Boolean).map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "??";
    const roleLine = assignedToDisplay2 !== "Unassigned" ? "Investigator • Case owner" : "HR Department • High Value Target";

    // ── Actions ────────────────────────────────────────────────────────────────
    const pushTimelineEntry = (entry) => setTimelineItems((prev) => [...prev, entry]);
    const currentTime = () => formatTime(new Date());

    const handleAssignToMe = () => {
        if (!canMutate()) return;
        if (assignOnceRef.current) return;
        const meTag = `${meName} (You)`;
        if (assignedToDisplay === meTag) return;
        if (assignedToDisplay !== "Unassigned" && assignedToDisplay.replace(/\s*\(You\)\s*$/i, "").trim() === meName) return;
        assignOnceRef.current = true;
        setAssignedTo(meTag);
        const persistedAssigned = updateIncidentStatusOnAssign(incident?.id, meTag);
        const currentStatus = String(incident?.status || "open").toLowerCase();
        const newStatus = (currentStatus === "new" || currentStatus === "open") ? "triage" : incident?.status;
        const updatedIncident = { ...(persistedAssigned || incident), owner: meTag, assignedTo: meTag, status: newStatus };
        setIncident(updatedIncident);
        upsertIncident(updatedIncident);
        pushTimelineEntry({ id: `asg-${Date.now()}`, color: "blue", icon: <UserPlus size={14} />, title: "Assignment", badge: "OWNER", badgeColor: "blue", time: currentTime(), source: "Console", actions: null });
        logAction("assign_incident", { incidentId: incident?.id, analyst: meName, message: `Assigned to ${meName}` });
        pushAudit({ action: "assigned", entityType: "incident", entityId: incident?.id || "—", analyst: meName, message: `Assigned to ${meName}` });
        pushNotification(`Incident ${incident?.id || ""} assigned to ${meName}`);
        window.dispatchEvent(new Event("soc_platform_data"));
    };

    const handleAddNote = () => {
        if (!canMutate() || noteBusy) return;
        const t = note.trim();
        if (!t) return;
        setNoteBusy(true);
        pushTimelineEntry({ id: `note-${Date.now()}`, color: "blue", icon: <User size={14} />, title: "Investigator Note", badge: "NOTE", badgeColor: "blue", time: currentTime(), source: meName, actions: null, desc: t });
        logAction("investigate_incident", { incidentId: incident?.id, analyst: meName, message: `Added investigation note` });
        setNote("");
        setNoteBusy(false);
    };

    const handleClassifyConfirm = ({ selected, comment }) => {
        if (!canMutate()) return;
        const classification = selected === "tp" ? "true_positive" : selected === "fp" ? "false_positive" : "duplicate";
        const label = classificationLabel(classification);

        try {
            // Use unified action handler
            const result = executeUnifiedAction("classify_incident", {
                incidentId: incident.id,
                classification,
                comment,
                analyst: meName,
            });

            if (result) {
                setIncident(result);
                pushTimelineEntry({
                    id: `cls-${Date.now()}`,
                    color: "green",
                    icon: <CheckCircle size={14} />,
                    title: `Incident classified as ${label} by ${meName}`,
                    badge: "CLASSIFIED",
                    badgeColor: "blue",
                    time: currentTime(),
                    source: meName,
                    actions: null,
                });
            }

            setClassifyOpen(false);
            window.dispatchEvent(new Event("soc_platform_data"));
        } catch (error) {
            console.error("Classification failed:", error);
            pushNotification(`Error classifying incident: ${error.message}`, { category: "incident" });
        }
    };

    const handleEscalateFromIncident = () => {
        if (!canMutate() || escalateBusy) return;
        const inc = incident;
        if (!inc?.id) return;
        setEscalateBusy(true);
        try {
            const result = upsertIncident(inc);
            const persisted = result?.incident || inc;
            const created = createCaseFromIncident(persisted);
            const caseId = created?.id;
            if (caseId) {
                const updatedIncident = { ...persisted, caseId, escalatedByUser: true };
                upsertIncident(updatedIncident);
                setIncident(updatedIncident);
                pushAudit({ action: "create case", entityType: "case", entityId: caseId, message: `Escalated incident ${inc.id}` });
                pushNotification(`Case ${caseId} linked to ${inc.id}`);

                // Add incident audit log
                addIncidentAuditLog({
                    type: "ESCALATED",
                    incidentId: inc.id,
                    caseId: caseId,
                    analyst: meName,
                });

                window.dispatchEvent(new Event("soc_platform_data"));
                navigate("/cases", { state: { caseId } });
            }
        } finally { setEscalateBusy(false); }
    };

    const handleCloseIncident = () => {
        if (!canMutate() || !incident?.id) return;
        const incidentStatus = String(incident?.status || "").toLowerCase();
        if (incidentStatus === "closed" || incidentStatus === "resolved") {
            pushNotification("Incident is already closed", { category: "incident" });
            return;
        }

        console.log("CLOSING INCIDENT:", incident.id);

        // Use unified action to classify incident as resolved (true positive)
        const result = executeUnifiedAction("classify_incident", {
            incidentId: incident.id,
            classification: "true_positive",
            analyst: meName,
            comment: "Incident closed by analyst",
        });

        if (result) {
            setIncident(result);
            pushTimelineEntry({
                id: `close-${Date.now()}`,
                color: "green",
                icon: <CheckCircle size={14} />,
                title: `Incident closed by ${meName}`,
                badge: "CLOSED",
                badgeColor: "gray",
                time: currentTime(),
                source: meName,
                actions: null,
            });

            // Notifications
            pushNotification(`Incident ${incident.id} closed`, { category: "incident" });
            if (incident.caseId) {
                pushNotification(`Case ${incident.caseId} closed`, { category: "case" });
            }

            // Trigger re-render
            window.dispatchEvent(new Event("soc_platform_data"));
        }
    };

    const filteredTimeline = (timelineItems || []).filter((item) =>
        filterSource === "all" || String(item.source || "").toLowerCase().includes(filterSource)
    );

    const onTimelineActionClick = (a) => {
        if (a.label === "Investigate IP") { navigate(`/intelligence?ip=${ip}`); return; }
        if (a.label === "Map Flow") { window.alert(`Mock path: ${ip} → Edge-FW-01 → Core-Switch-02 → FINANCE-WS-04`); return; }
        if (a.label === "Inspect Logs") { navigate("/logs"); return; }
        a.onClick?.();
    };

    const exportIncidentJson = () => {
        const iid = incident?.id || "incident";
        const payload = { id: iid, ip, status: incidentStatusDisplay, assignedTo: assignedToDisplay, mitre: mitreTechniques, alertIds: incident?.alertIds || [], timeline: timelineItems.map((t) => ({ id: t.id, title: t.title, badge: t.badge, time: t.time, source: t.source })), exportedAt: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `incident-${String(iid).replace(/[^a-z0-9-]/gi, "_")}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    useEffect(() => () => { if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current); }, []);

    const handleTriggerProcessScan = () => {
        if (!canMutate() || scanBusy) return;
        if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
        setScanBusy(true);
        setScanResult(null);
        scanTimerRef.current = window.setTimeout(() => {
            scanTimerRef.current = null;
            setScanBusy(false);
            setScanResult("wininit.exe → services.exe → lsass.exe (no unsigned children). Suspicious module not loaded — baseline match.");
            pushTimelineEntry({ id: `scan-${Date.now()}`, color: "amber", icon: <Terminal size={14} />, title: "Process Scan Complete", badge: "HOST", badgeColor: "amber", time: currentTime(), source: "Sysmon", actions: null });
        }, 1200);
    };

    if (incident && alertId && !baseAlert && !(Array.isArray(incident.alertIds) && incident.alertIds.includes(alertId))) {
        return <div>No Incident Data</div>;
    }
    if (incident && alertId && !relatedAlerts?.length && !(Array.isArray(incident.alertIds) && incident.alertIds.includes(alertId))) {
        return <div>No Correlated Alerts</div>;
    }
    if (!incident) return <div>No incident found</div>;

    return (
        <div className="inc-page">
            {/* TOPBAR */}
            <header className="inc-topbar">
                <div className="inc-topbar-left">
                    <div className="inc-logo"><SocLogo /></div>
                    <nav className="inc-topnav">
                        <NavLink to="/dashboard">Dashboard</NavLink>
                        <NavLink to="/alerts">Alerts</NavLink>
                        <NavLink to="/incidents" className="active">Incidents</NavLink>
                        <NavLink to="/intelligence">Intelligence</NavLink>
                        <NavLink to="/cases">Cases</NavLink>
                        <NavLink to="/audit">Audit &amp; Metrics</NavLink>
                        <NavLink to="/settings">Settings</NavLink>
                    </nav>
                </div>
                <div className="inc-topbar-right">
                    <div className="inc-search">
                        <Search size={16} />
                        <input placeholder="Search incidents..." />
                    </div>
                    <div className="inc-icon-btns">
                        <HeaderNotificationBell className="inc-icon-btn"><Bell size={18} /></HeaderNotificationBell>
                        <HeaderSettingsNav className="inc-icon-btn"><Settings size={18} /></HeaderSettingsNav>
                    </div>
                    <HeaderMenuAvatar className="inc-avatar" onLogout={() => { logoutSession(); navigate("/"); }} />
                </div>
            </header>

            <div className="inc-body">
                {/* SIDEBAR */}
                <aside className="inc-sidebar">
                    <div className="inc-sidebar-inner">
                        <div>
                            <p className="inc-sidebar-section-title">Investigation Context</p>
                            <div className="inc-sidebar-nav">
                                {[
                                    { key: "overview", icon: <LayoutDashboard size={18} />, label: "Overview" },
                                    { key: "history", icon: <History size={18} />, label: "Full History" },
                                ].map(({ key, icon, label }) => (
                                    <div key={key} className={`inc-nav-item ${ctxNav === key ? "active" : ""}`} role="button" tabIndex={0} onClick={() => setCtxNav(key)} onKeyDown={(e) => e.key === "Enter" && setCtxNav(key)}>
                                        {icon}<span>{label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="inc-sidebar-divider">
                            <p className="inc-sidebar-section-title muted">Active Responders</p>
                            <div className="inc-responders">
                                <div className="inc-responder">
                                    <span className="inc-dot green" />
                                    <span>{assignedToDisplay !== "Unassigned" ? assignedToDisplay : "S. Miller (You)"}</span>
                                </div>
                                <div className="inc-responder offline">
                                    <span className="inc-dot gray" />
                                    <span>J. Doe (Offline)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="inc-sidebar-footer" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button type="button" className="inc-assign-btn" onClick={handleAssignToMe} disabled={!canMutate()}>
                            <UserPlus size={16} />Assign to Me
                        </button>
                    </div>
                </aside>

                {/* MAIN */}
                <main className="inc-main">
                    {/* INCIDENT HEADER */}
                    <div className="inc-header">
                        <div className="inc-header-left">
                            <div className="inc-header-meta">
                                <span className="inc-critical-badge">{String(incident?.severity || "critical").toUpperCase()}</span>
                                <h1>{`#INC-${incident?.id || "—"}`}</h1>
                                <span className={`inc-badge badge-${reviewBadge.color}`} style={{ marginLeft: 12, fontSize: 11 }}>
                                    {reviewBadge.label} ({correlationScore}/100)
                                </span>
                            </div>
                            <p className="inc-header-sub">
                                IP: {ip} • Alerts: {(relatedAlerts || []).length} • Severity: {String(incident?.severity || "low").toUpperCase()} • Owner: {assignedToDisplay} • Status: <span style={statusBadgeStyle}>{incidentStatusDisplay}</span>
                                {incidentStatusValue === "closed" && incident?.classification ? (
                                    <>
                                        {" "}
                                        <span className="inc-badge badge-gray" style={{ fontSize: 11, marginLeft: 6 }}>
                                            Closed • {classificationLabel(incident.classification)}
                                        </span>
                                    </>
                                ) : null}
                            </p>
                        </div>
                        <div className="inc-header-actions">
                            <button type="button" className="inc-btn-outline" onClick={exportIncidentJson}>Share Report</button>
                            {(() => {
                                // Check if already escalated using multiple indicators
                                const alreadyEscalated =
                                    linkedCase ||
                                    incident?.escalated === true ||
                                    incident?.autoEscalated === true ||
                                    incident?.caseId;

                                if (alreadyEscalated) {
                                    return (
                                        <button type="button" className="inc-btn-dark" disabled>
                                            Already Escalated
                                        </button>
                                    );
                                } else {
                                    return (
                                        <button type="button" className="inc-btn-dark" onClick={handleEscalateFromIncident} disabled={!canMutate() || escalateBusy || !incident?.id}>
                                            Escalate to Case
                                        </button>
                                    );
                                }
                            })()}
                        </div>
                    </div>

                    {/* TABS */}
                    {ctxNav === "overview" && (
                        <div className="inc-tabs">
                            {[
                                { id: "timeline", label: "Timeline" },
                                { id: "processes", label: "Related Processes" },
                            ].map((tab) => (
                                <button key={tab.id} type="button" className={`inc-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="inc-grid">
                        {/* LEFT COLUMN */}
                        <div className="inc-left-col">
                            {ctxNav === "overview" && activeTab === "timeline" && (
                                <div className="inc-card">
                                    <div className="inc-card-header">
                                        <span className="inc-card-title">Correlated Alert Sequence</span>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            {["all", "wazuh", "sysmon", "suricata", "network ml"].map((src) => (
                                                <button key={src} type="button" className="inc-filter-btn" onClick={() => setFilterSource(src)}>
                                                    {src === "all" ? "All" : src}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Correlation Sources */}
                                    <div className="inc-corr-sources">
                                        <p className="inc-corr-title">Correlation Sources</p>
                                        <div className="inc-corr-grid">
                                            {sourceSummary.map((src) => (
                                                <div key={src} className="inc-corr-card">
                                                    <div className="inc-corr-card-header">
                                                        {src === "Wazuh" ? <Terminal size={16} /> : src === "Sysmon" ? <Cpu size={16} /> : <Network size={16} />}
                                                        <span>{src}</span>
                                                    </div>
                                                    <p>Correlated alert source</p>
                                                    <span className="inc-corr-matched">Matched Evidence</span>
                                                    <span className="inc-corr-confidence">Confidence: High</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="inc-corr-result">
                                            <strong>Correlation Result:</strong> {sourceSummary.join(" + ")}
                                            <div className="inc-corr-meta">
                                                Attack Graph: {["Recon", "Access", "Execution", "C2"].map((s) => `${s} (${stageBuckets[s].length})`).join(" → ")}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Attack Map Flow */}
                                    <div className="inc-corr-result" style={{ margin: "0 20px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <span className="inc-badge badge-red" style={{ fontSize: 11, padding: "4px 10px" }}>{ip || "SRC"}</span>
                                        {activeStages.map((stage, i) => (
                                            <span key={stage} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <MoveRight size={14} style={{ color: "#92b7c9" }} />
                                                <span className={`inc-badge badge-${stage === "C2" ? "red" : stage === "Execution" ? "amber" : "blue"}`} style={{ fontSize: 11, padding: "4px 10px" }}>
                                                    {stage} ({stageBuckets[stage].length})
                                                </span>
                                            </span>
                                        ))}
                                        {(relatedAlerts || []).some((a) => a.dstIP) && (
                                            <>
                                                <MoveRight size={14} style={{ color: "#92b7c9" }} />
                                                <span className="inc-badge badge-amber" style={{ fontSize: 11, padding: "4px 10px" }}>
                                                    {(relatedAlerts || []).find((a) => a.dstIP)?.dstIP}
                                                </span>
                                            </>
                                        )}
                                    </div>

                                    {/* Timeline */}
                                    <div className="inc-timeline">
                                        {filteredTimeline.map((item, idx) => (
                                            <div key={item.id} className={`inc-timeline-item ${idx < filteredTimeline.length - 1 ? "has-line" : ""}`}>
                                                <div className={`inc-timeline-dot dot-${item.color}`}>
                                                    {item.icon}
                                                </div>
                                                <div className="inc-timeline-content">
                                                    <div className="inc-timeline-top">
                                                        <h4>
                                                            {item.title}
                                                            <span className={`inc-badge badge-${item.badgeColor}`}>{item.badge}</span>
                                                            <span className={`inc-badge stage-badge stage-${String(item.stage || "unknown").toLowerCase()}`}>{item.stage}</span>
                                                        </h4>
                                                    </div>
                                                    {item.sub && <p className="inc-timeline-desc"><strong>Sub:</strong> {item.sub}</p>}
                                                    <p className="inc-timeline-desc"><strong>Source:</strong> {item.source} • <strong>Severity:</strong> {item.severity}</p>
                                                    {item.dstIP && <p className="inc-timeline-desc"><strong>Destination:</strong> {item.dstIP}</p>}
                                                    {item.desc && typeof item.desc === "string" && <p className="inc-timeline-desc">{item.desc}</p>}
                                                    <div className="inc-timeline-btns">
                                                        {(item.actions || []).map((a, i) => (
                                                            <button key={`action-${item.id}-${i}`} type="button" className={`${a.primary ? "btn-primary primary" : "btn-outline"} inc-action-btn`} onClick={() => onTimelineActionClick(a)} disabled={a.disabled || !canMutate()}>{a.label}{a.disabled ? " ✓" : ""}</button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="inc-time">{item.time}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {ctxNav === "overview" && activeTab === "processes" && (
                                <div className="inc-card">
                                    <div className="inc-card-header">
                                        <span className="inc-card-title">Related Process Tree</span>
                                    </div>
                                    {scanBusy ? (
                                        <div className="inc-empty-state">
                                            <div className="inc-empty-icon"><GitBranch size={36} /></div>
                                            <h4>Scanning host processes…</h4>
                                            <p>Querying Sysmon Event ID 1 / 3 on FINANCE-WS-04.</p>
                                        </div>
                                    ) : scanResult ? (
                                        <div className="inc-empty-state">
                                            <div className="inc-empty-icon"><GitBranch size={36} /></div>
                                            <h4>Mock enrichment ready</h4>
                                            <p>{scanResult}</p>
                                            <button type="button" className="inc-scan-btn" onClick={() => { setScanBusy(false); setScanResult(null); }}>Run again</button>
                                        </div>
                                    ) : (
                                        <div className="inc-empty-state">
                                            <div className="inc-empty-icon"><GitBranch size={36} /></div>
                                            <h4>Waiting for Sysmon correlation...</h4>
                                            <p>No host-level correlation found yet.</p>
                                            <button type="button" className="inc-scan-btn" onClick={handleTriggerProcessScan} disabled={!canMutate()}>Trigger Process Scan</button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {ctxNav === "history" && (
                                <div className="inc-card">
                                    <div className="inc-card-header">
                                        <span className="inc-card-title">Full History</span>
                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                            {["all", "wazuh", "sysmon", "suricata", "network ml"].map((src) => (
                                                <button key={src} type="button" className="inc-filter-btn" onClick={() => setFilterSource(src === "all" ? "all" : src)}>
                                                    {src === "all" ? "All" : src}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="inc-timeline">
                                        {filteredTimeline.map((item, idx) => (
                                            <div key={item.id} className={`inc-timeline-item ${idx < filteredTimeline.length - 1 ? "has-line" : ""}`}>
                                                <div className={`inc-timeline-dot dot-${item.color}`}>{item.icon}</div>
                                                <div className="inc-timeline-content">
                                                    <div className="inc-timeline-top">
                                                        <h4>{item.title}<span className={`inc-badge badge-${item.badgeColor}`}>{item.badge}</span></h4>
                                                    </div>
                                                    <p className="inc-timeline-desc"><strong>Source:</strong> {item.source} • <strong>Severity:</strong> {item.severity}</p>
                                                    {item.desc && typeof item.desc === "string" && <p className="inc-timeline-desc">{item.desc}</p>}
                                                </div>
                                                <div className="inc-time">{item.time}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* RIGHT COLUMN */}
                        <div className="inc-right-col">
                            {/* MITRE ATT&CK */}
                            <div className="inc-card mitre-panel">
                                <p className="inc-section-title">Threat Intelligence</p>

                                <div className="inc-intel-block">
                                    <p className="inc-intel-label">Correlation Score</p>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <div style={{ flex: 1, background: "#1f2937", borderRadius: 4, height: 8, overflow: "hidden" }}>
                                            <div style={{ background: correlationScore >= 90 ? "#ef4444" : "#f59e0b", height: "100%", width: `${correlationScore}%`, transition: "width 0.3s" }} />
                                        </div>
                                        <span style={{ fontSize: 14, fontWeight: 600, color: correlationScore >= 90 ? "#ef4444" : "#f59e0b" }}>{correlationScore}/100</span>
                                    </div>
                                    <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>{reviewBadge.detail}</p>
                                </div>

                                <div className="inc-intel-block" role="button" tabIndex={0} onClick={() => ip && navigate(`/intelligence?ip=${ip}`)} onKeyDown={(e) => e.key === "Enter" && ip && navigate(`/intelligence?ip=${ip}`)}>
                                    <p className="inc-intel-label">IP Reputation ({ip})</p>
                                    <p className="inc-score" style={{ fontSize: 14, color: "#f87171" }}>Investigate →</p>
                                </div>

                                <div className="inc-intel-block">
                                    <p className="inc-intel-label">MITRE ATT&amp;CK Mapping</p>
                                    <div className="inc-mitre-tags">
                                        {mitreTechniques.length ? mitreTechniques.map((t) => (
                                            <span key={t.id} title={t.name}>{t.id} — {t.name}</span>
                                        )) : <span style={{ color: "#92b7c9" }}>No techniques detected</span>}
                                    </div>
                                </div>

                                <div className="inc-intel-block">
                                    <p className="inc-intel-label">Attack Summary</p>
                                    <div className="inc-asset-details">
                                        <div className="inc-detail-row"><span>Sources</span><span>{sourceSummary.join(", ") || "N/A"}</span></div>
                                        <div className="inc-detail-row"><span>Active Stages</span><span>{activeStages.join(" → ") || "N/A"}</span></div>
                                        <div className="inc-detail-row"><span>Affected IP</span><span className="mono">{ip || "N/A"}</span></div>
                                    </div>
                                </div>

                                <div className="inc-identity-block">
                                    <div className="inc-identity-header"><User size={16} /><span>Affected Identity</span></div>
                                    <div className="inc-identity-user">
                                        <div className="inc-avatar-initials">{initials}</div>
                                        <div>
                                            <p className="inc-user-name">{displayName}</p>
                                            <p className="inc-user-role">{roleLine}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* AFFECTED ASSET */}
                            <div className="inc-intel-block standalone">
                                <div className="inc-asset-header">
                                    <div className="inc-asset-title"><Laptop size={16} /><span>Affected Asset</span></div>
                                </div>
                                <div className="inc-asset-details">
                                    <div className="inc-detail-row"><span>IP Address</span><span className="mono">{ip}</span></div>
                                    <div className="inc-detail-row"><span>OS Version</span><span>Windows 11 Pro</span></div>
                                    <div className="inc-detail-row"><span>EDR Status</span><span className="inc-edr-online"><CheckCircle size={12} />Online</span></div>
                                </div>
                            </div>

                            {/* INVESTIGATOR NOTES */}
                            <div className="inc-notes-card">
                                <h4>Investigator Notes</h4>
                                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add observation or findings..." disabled={!canMutate()} />
                                <div className="inc-notes-btns">
                                    <button type="button" className="inc-add-note-btn" onClick={handleAddNote} disabled={!canMutate() || noteBusy}>Add Note &amp; Share</button>
                                    <div className="inc-resolution">
                                        <button
                                            type="button"
                                            className="inc-fp-btn"
                                            onClick={() => { setClassifyInitial("tp"); setClassifyOpen(true); }}
                                            disabled={!canMutate() || incidentStatusValue === "closed"}
                                            title=""
                                        >
                                            Classify Incident
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* AUDIT TIMELINE REMOVED - Use Audit & Metrics page instead */}
                        </div>
                    </div>
                </main>

                {classifyOpen && (
                    <ClassifyModal
                        incident={incident}
                        incidentId={incident?.id || "—"}
                        initialSelected={classifyInitial}
                        onClose={() => setClassifyOpen(false)}
                        onConfirm={handleClassifyConfirm}
                    />
                )}
            </div>
        </div>
    );
}
