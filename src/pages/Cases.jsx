import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import {
    Search, Bell, Settings, FolderOpen, Folder,
    PlusCircle, User, AlertTriangle, Clock, Archive,
    Shield, Link, AlertCircle, Zap, CheckCircle,
    RotateCcw, UserPlus, Share2, Flag, Trash2, Loader2,
    Bold, Italic, List, Paperclip, History, FileText, UserMinus
} from "lucide-react";
import "../styles/cases.css";
import ClassifyModal from "../components/Alerts/ClassifyModal";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import { canMutate, getCurrentUser, logoutSession, userDisplayName, isAdmin } from "../session";
import { formatTime } from "../utils/formatTime";
import { getCases, getIncidents, createCaseFromIncident, pushAudit, pushNotification, setCases, syncIncidentStatusWithCase, executeUnifiedAction, syncWithBackend } from "../platformStore";
import { addAuditLog, AUDIT_ACTIONS, AUDIT_SEVERITY } from "../services/auditLogger";
import { addCaseTimelineEvent, addCaseNote } from "../api/socService";

const PHASES = ["detection", "triage", "containment", "eradication", "recovery", "closed"];

function getSlaDuration(priority) {
    switch (String(priority || "").toLowerCase()) {
        case "critical":
            return 15 * 60;
        case "high":
            return 60 * 60;
        case "medium":
            return 4 * 60 * 60;
        default:
            return 24 * 60 * 60;
    }
}

function checkAndEscalateMaliciousIoc(caseItem) {
    // Mock IOC enrichment logic
    const ioc = caseItem?.ioc || {};
    const isMalicious = ioc.malicious === true || (ioc.abuseScore && ioc.abuseScore > 80);

    if (!isMalicious) return null;

    // Auto-escalate case
    const escalated = {
        ...caseItem,
        severity: "critical",
        priority: "critical",
        escalated: true,
        tags: Array.isArray(caseItem?.tags) ? caseItem.tags : []
    };

    if (!escalated.tags.includes("malicious-ip")) {
        escalated.tags.push("malicious-ip");
    }

    return escalated;
}

function mergeAuditLogs(prevLogs = [], newLogs = []) {
    const combined = [...prevLogs, ...newLogs];
    const unique = [];
    const seen = new Set();
    for (const item of combined) {
        if (!item) continue;
        const key = item.id || `${item.title}-${item.at}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
        }
    }
    return unique.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function buildInitialAuditLog(caseItem) {
    const baseMs = Date.parse(caseItem?.createdAt || "") || Date.now();
    const mockEvents = [
        {
            id: "mock-1",
            type: "primary",
            icon: <Shield size={14} />,
            title: "Automated Containment",
            at: new Date(baseMs + (18 * 60 * 1000)).toISOString(),
            text: <>System isolated endpoint <code>{caseItem?.affectedMachine?.hostname || caseItem?.ip || "target-host"}</code> after suspicious PowerShell execution.</>,
        },
        {
            id: "mock-2",
            type: "secondary",
            icon: <User size={14} />,
            title: "Analyst Assigned",
            at: new Date(baseMs + (9 * 60 * 1000)).toISOString(),
            text: <>Lead analyst <span className="cases-highlight">{caseItem?.openedBy || "SOC Analyst"}</span> took ownership of the case.</>,
        },
        {
            id: "mock-3",
            type: "secondary",
            icon: <Link size={14} />,
            title: "Incident Linked",
            at: new Date(baseMs + (3 * 60 * 1000)).toISOString(),
            text: <>Alert IDs <code>{(caseItem?.alertIds || []).slice(0, 2).join(", ") || caseItem?.incidentId || "—"}</code> correlated into this case.</>,
        },
        {
            id: "mock-4",
            type: "secondary",
            icon: <AlertCircle size={14} />,
            title: "Priority Escalated",
            at: new Date(baseMs + (1 * 60 * 1000)).toISOString(),
            text: <>Status changed to <span className="cases-text-red">{caseItem?.severityLabel || "HIGH"}</span> by correlation engine.</>,
        },
    ];

    const realEvents = (Array.isArray(caseItem?.timeline) ? caseItem.timeline : []).map((t, idx) => ({
        id: t.id || `real-${idx}-${t.created_at}`,
        type: t.type || "secondary",
        icon: t.type === "primary" ? <Shield size={14} /> : <Zap size={14} />,
        title: t.title || "Case Event",
        at: t.created_at || t.createdAt || new Date().toISOString(),
        text: t.text || "",
    }));

    const combined = [...realEvents, ...mockEvents];
    combined.sort((a, b) => new Date(b.at) - new Date(a.at));
    return combined;
}

const buildCaseStateRow = (c) => {
    const status = String(c.status || "").toLowerCase();
    const isClosed = status === "closed" || status === "resolved";
    const isTriage = status === "triage" || status === "open";

    // Calculate dynamic SLA
    const createdAt = c.createdAt ? new Date(c.createdAt).getTime() : Date.now();
    const elapsedSeconds = Math.floor((Date.now() - createdAt) / 1000);
    const slaDurationSeconds = getSlaDuration(c.priority);
    const remainingSeconds = Math.max(0, slaDurationSeconds - elapsedSeconds);

    // Convert remaining seconds to h:m:s
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;

    // Determine SLA state
    const slaBreach = remainingSeconds === 0 && !isClosed;
    const slaRunning = !isClosed && remainingSeconds > 0;

    return {
        auditLog: buildInitialAuditLog(c).map((x) => ({ ...x, id: x.id })),
        currentStatus: isClosed ? "Closed" : "In Progress",
        currentPhase: isClosed ? "Closed Phase" : isTriage ? "Triage Phase" : "Phase: Containment & Eradication",
        activePhase: isClosed ? "closed" : "triage",
        slaTime: { h: hours, m: minutes, s: seconds },
        slaRunning,
        slaBreach,
        mitre: c.mitre || [],
        noteDraft: "",
        lastSavedAt: null,
        assignedTo: c.assignedTo,
        isMine: c.isMine,
        archived: c.archived,
        pending: c.pending,
        priority: c.priority,
    };
};

export default function Cases() {
    const navigate = useNavigate();
    const location = useLocation();

    const meName = userDisplayName(getCurrentUser());
    const meEmail = getCurrentUser()?.email || "";
    const [caseList, setCaseList] = useState(() => {
        const stored = getCases();
        return stored?.length ? stored : [];
    });

    const [selectedCaseId, setSelectedCaseId] = useState(() => {
        const stored = getCases();
        return stored?.[0]?.id || "";
    });
    const [caseViewFilter, setCaseViewFilter] = useState("all"); // all|mine|high|pending|archived
    const [caseSearch, setCaseSearch] = useState("");
    const [casePage, setCasePage] = useState(1);
    const [highlightedCaseId, setHighlightedCaseId] = useState(null);

    const [caseStates, setCaseStates] = useState(() => {
        const stored = getCases();
        const seed = stored?.length ? stored : [];
        return Object.fromEntries(seed.map((c) => [c.id, buildCaseStateRow(c)]));
    });

    useEffect(() => {
        const stateCaseId = location.state?.caseId;
        const params = new URLSearchParams(location.search);
        const queryCaseId = params.get("caseId");
        const targetCaseId = stateCaseId || queryCaseId;
        if (targetCaseId) {
            setSelectedCaseId(targetCaseId);
            setCaseViewFilter("all");
        }
    }, [location]);

    useEffect(() => {
        setCasePage(1);
    }, [caseViewFilter, caseSearch]);

    const selectedCase = useMemo(() => caseList.find((c) => c.id === selectedCaseId) || caseList[0] || null, [caseList, selectedCaseId]);
    const incidentForClassifyModal = useMemo(() => {
        const incId = selectedCase?.incidentId;
        const fallback = {
            ip: selectedCase?.ip || "",
            correlationScore: 55,
            sources: Array.isArray(selectedCase?.sources) ? selectedCase.sources : [],
        };
        if (!incId) return selectedCase?.ip ? fallback : null;
        return getIncidents().find((i) => i.id === incId) || fallback;
    }, [selectedCase]);
    const selectedState = selectedCase ? (caseStates[selectedCaseId] || buildCaseStateRow(selectedCase)) : buildCaseStateRow({ assignedTo: "CURRENT_USER", isMine: true, archived: false, pending: true, priority: "high" });

    const resolveAssign = (v) => (v === "CURRENT_USER" ? userDisplayName(getCurrentUser()) : v);

    const auditLog = selectedState.auditLog;
    const currentStatus = selectedState.currentStatus;
    const currentPhase = selectedState.currentPhase;
    const activePhase = selectedState.activePhase;
    const slaTime = selectedState.slaTime;
    const slaRunning = selectedState.slaRunning;
    const slaBreach = selectedState.slaBreach;
    const mitre = useMemo(() => {
        const raw = selectedCase?.mitre || [];
        if (raw.length) return raw;
        const alerts = selectedCase?.alerts || [];
        const map = { "ssh": "T1110", "process": "T1059", "traffic": "T1071", "scan": "T1046" };
        const result = new Set();
        alerts.forEach(a => {
            const d = (a.ruleDescription || a.desc || "").toLowerCase();
            Object.keys(map).forEach(k => { if (d.includes(k)) result.add(map[k]); });
        });
        return Array.from(result);
    }, [selectedCase]);
    const noteDraft = selectedState.noteDraft;

    const pad = (n) => String(n).padStart(2, "0");

    const persistCaseList = (next) => {
        setCases(next);
        setCaseList(next);
    };

    const getResponseFromMitre = (mitreList) => {
        if (!mitreList) return [];
        const actions = [];
        const ids = mitreList.map(m => typeof m === "string" ? m : m?.id).filter(Boolean);
        if (ids.includes("T1110")) actions.push("block_ip");
        if (ids.includes("T1059")) actions.push("kill_process");
        if (ids.includes("T1071")) actions.push("block_domain");
        return actions;
    };

    const updateSelectedCaseState = (updater) => {
        setCaseStates((prev) => {
            const cur = prev[selectedCaseId];
            return {
                ...prev,
                [selectedCaseId]: updater(cur || buildCaseStateRow(selectedCase || { assignedTo: "CURRENT_USER", isMine: true, archived: false, pending: true, priority: "high" })),
            };
        });
    };

    const addAudit = (text, type = "primary", textContent = null) => {
        const entry = {
            id: `case-a-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type,
            icon: <Zap size={14} />,
            title: text,
            at: new Date().toISOString(),
            text: textContent,
        };
        updateSelectedCaseState((cur) => ({
            ...cur,
            auditLog: [entry, ...cur.auditLog],
        }));
        pushAudit({ action: text, entityType: "case", entityId: selectedCaseId, message: text });
    };

    const simulateResponse = (action) => {
        if (!canMutate()) return;
        executeAction(action);
    };

    const executeAction = async (action) => {
        if (!canMutate()) return;
        const map = {
            isolate: "Host isolated — containment applied",
            kill_process: "Malicious process terminated",
            block_ip: "Malicious IP blocked at firewall",
            block_domain: "Malicious domain blocked via DNS filtering",
            disable_user: "User account disabled (simulation)",
            collect_artifacts: "Memory & forensic artifacts collected",
            collect_logs: "Endpoint logs pulled for analysis",
            run_edr: "EDR scan initiated",
        };
        const analyst = userDisplayName(getCurrentUser());
        const actionText = `${map[action] || action} by ${analyst}`;

        try {
            await addCaseTimelineEvent(selectedCaseId, {
                title: map[action] || action,
                text: `Action performed by ${analyst}`,
                type: "secondary"
            });
            pushNotification(`${map[action] || action} by ${analyst} — ${selectedCaseId}`, { category: "response" });
            await syncWithBackend();
        } catch (error) {
            console.error("Failed to persist incident response action timeline event:", error);
            addAudit(actionText);
            pushNotification(`${map[action] || action} by ${analyst} — ${selectedCaseId}`, { category: "response" });
        }

        if (action === "isolate") {
            updateSelectedCaseState((cur) => ({
                ...cur,
                currentStatus: "Contained",
                slaRunning: false,
                activePhase: "containment",
                currentPhase: "Containment Phase",
            }));
        }
        if (action === "kill_process") {
            updateSelectedCaseState((cur) => ({
                ...cur,
                currentStatus: "Eradicating",
                activePhase: "eradication",
                currentPhase: "Eradication Phase",
            }));
        }
        if (action === "block_ip") {
            updateSelectedCaseState((cur) => ({
                ...cur,
                activePhase: "containment",
                currentPhase: "Containment Phase",
            }));
        }
        if (action === "collect_logs") {
            updateSelectedCaseState((cur) => ({
                ...cur,
                activePhase: "triage",
                currentPhase: "Investigation Phase",
            }));
        }
        if (action === "disable_user") {
            updateSelectedCaseState((cur) => ({
                ...cur,
                activePhase: "containment",
                currentPhase: "Containment Phase",
            }));
        }
    };

    const handleResume = () => {
        if (!canMutate()) return;
        // Update caseList to mark as not archived/pending and persist to store
        const next = caseList.map((c) =>
            c.id === selectedCaseId
                ? {
                    ...c,
                    archived: false,
                    pending: false,
                    status: "open",
                }
                : c
        );
        persistCaseList(next);

        updateSelectedCaseState((cur) => ({
            ...cur,
            currentStatus: "Investigation Resumed",
            slaRunning: true,
            slaBreach: false,
            activePhase: "triage",
        }));
        addAudit("Investigation resumed — SLA restarted");
    };

    const handleReinfection = () => {
        if (!canMutate()) return;
        // Update caseList to mark as not archived/pending and persist to store
        const next = caseList.map((c) =>
            c.id === selectedCaseId
                ? {
                    ...c,
                    archived: false,
                    pending: false,
                    status: "open",
                }
                : c
        );
        persistCaseList(next);

        updateSelectedCaseState((cur) => ({
            ...cur,
            currentStatus: "Threat Reappeared",
            slaRunning: true,
            slaBreach: false,
            activePhase: "containment",
        }));
        addAudit("Reinfection detected — MITRE techniques reactivated");
    };

    // Confirm modal used by response-action critical buttons.
    const [showConfirm, setShowConfirm] = useState(false);
    const [pendingAction, setPendingAction] = useState(null);
    const [responseBusy, setResponseBusy] = useState(null);

    const [classifyOpen, setClassifyOpen] = useState(false);
    const [classifyInitial, setClassifyInitial] = useState("tp");

    const [assignOpen, setAssignOpen] = useState(false);
    const [assignTarget, setAssignTarget] = useState(userDisplayName(getCurrentUser()));

    const [escalateOpen, setEscalateOpen] = useState(false);
    const [escalateLevel, setEscalateLevel] = useState("L2");
    const [escalateAssignee, setEscalateAssignee] = useState("SOC Lead");
    const [escalateReason, setEscalateReason] = useState("");
    const [escalateBusy, setEscalateBusy] = useState(false);
    const [saveNoteBusy, setSaveNoteBusy] = useState(false);
    const [assignSubmitBusy, setAssignSubmitBusy] = useState(false);

    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState("");
    const [selectedPermission, setSelectedPermission] = useState("View");
    const [shareMessage, setShareMessage] = useState("");

    useEffect(() => {
        if (!slaRunning) return;
        const interval = setInterval(() => {
            updateSelectedCaseState((cur) => {
                let { h, m, s } = cur.slaTime;
                if (h === 0 && m === 0 && s === 0) {
                    if (cur.slaBreach) return cur;
                    // SLA breached: trigger full escalation workflow
                    const previousPriority = cur.priority || "high";

                    // Update caseList with breach state and persist to store
                    const next = caseList.map((c) =>
                        c.id === selectedCaseId
                            ? {
                                ...c,
                                priority: "critical",
                                severity: "critical",
                                escalated: true,
                                escalationLevel: "L2",
                            }
                            : c
                    );
                    persistCaseList(next);

                    // Add audit entry
                    setTimeout(() => {
                        addAudit(
                            `SLA Breach triggered automatic escalation to L2 (was ${previousPriority})`,
                            "danger"
                        );
                    }, 0);

                    return {
                        ...cur,
                        slaRunning: false,
                        slaBreach: true,
                        currentStatus: "SLA Breached",
                        priority: "critical",
                        escalated: true,
                        escalationLevel: "L2",
                    };
                }
                if (s > 0) s--;
                else {
                    s = 59;
                    if (m > 0) m--;
                    else {
                        m = 59;
                        if (h > 0) h--;
                    }
                }
                return { ...cur, slaTime: { h, m, s } };
            });
        }, 1000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCaseId, slaRunning]);

    const handleSaveNote = async () => {
        if (!canMutate() || saveNoteBusy) return;
        const t = (noteDraft || "").trim();
        if (!t) return;
        setSaveNoteBusy(true);
        try {
            await addCaseNote(selectedCaseId, t);

            updateSelectedCaseState((cur) => ({
                ...cur,
                noteDraft: "",
                lastSavedAt: new Date(),
            }));
            pushNotification(`Note successfully added and persisted to Case ${selectedCaseId}`);
            
            await syncWithBackend();
        } catch (error) {
            console.error("Failed to save note:", error);
            pushNotification(`Error saving note: ${error.message || error}`);
        } finally {
            setSaveNoteBusy(false);
        }
    };

    const handleCloseCase = () => {
        if (!canMutate()) return;
        setClassifyInitial("tp");
        setClassifyOpen(true);
    };

    const handleClassifyConfirm = async ({ selected, comment }) => {
        if (!canMutate()) return;
        const classification = selected === "tp" ? "true_positive" : selected === "fp" ? "false_positive" : "duplicate";
        const label = selected === "tp" ? "True Positive" : selected === "fp" ? "False Positive" : "Duplicate";

        const result = executeUnifiedAction("close_case", {
            caseId: selectedCaseId,
            classification,
            comment,
            analyst: userDisplayName(getCurrentUser()),
        });

        if (result) {
            // Update caseList with closed status and persist to store
            const next = caseList.map((c) =>
                c.id === selectedCaseId
                    ? {
                        ...c,
                        status: "closed",
                        archived: true,
                        pending: false,
                        closedAt: new Date().toISOString(),
                    }
                    : c
            );
            persistCaseList(next);

            // Update local state - set archived to true when case closes
            updateSelectedCaseState((cur) => ({
                ...cur,
                currentStatus: `Closed (${label})`,
                activePhase: "closed",
                currentPhase: "Closed Phase",
                slaRunning: false,
                slaBreach: false,
                pending: false,
                archived: true,
            }));

            pushNotification(`Case ${selectedCaseId} classified: ${label}`);
            await syncWithBackend();
        }

        setClassifyOpen(false);
    };

    const handleAssignSubmit = async () => {
        if (assignSubmitBusy) return;
        setAssignSubmitBusy(true);
        const target = (assignTarget || "").trim() || userDisplayName(getCurrentUser());
        const cu = userDisplayName(getCurrentUser()).trim();
        const em = (getCurrentUser()?.email || "").trim();
        const isMine = target === cu || (!!em && target === em) || target.includes(cu);

        if (!isAdmin() && !isMine) {
            pushNotification("Non-admin users can only assign cases to themselves.");
            setAssignOpen(false);
            setAssignSubmitBusy(false);
            return;
        }

        const prevResolved = resolveAssign(selectedState.assignedTo);
        if (prevResolved === target) {
            setAssignOpen(false);
            setAssignSubmitBusy(false);
            return;
        }

        try {
            const result = executeUnifiedAction("assign_case", {
                caseId: selectedCaseId,
                assignedTo: target,
                analyst: userDisplayName(getCurrentUser()),
            });

            if (result) {
                // Update caseList with new assignment and persist to store
                const next = caseList.map((c) =>
                    c.id === selectedCaseId
                        ? {
                            ...c,
                            assignedTo: target,
                            isMine,
                        }
                        : c
                );
                persistCaseList(next);

                // Update local state
                updateSelectedCaseState((cur) => ({
                    ...cur,
                    assignedTo: target,
                    isMine,
                }));

                pushNotification(`Case ${selectedCaseId} assigned to ${target}`);
                await syncWithBackend();
            }
        } catch (error) {
            console.error("Assignment failed:", error);
            pushNotification(`Assignment failed: ${error.message || error}`);
        } finally {
            setAssignOpen(false);
            setAssignSubmitBusy(false);
        }
    };

    const handleReleaseCase = () => {
        if (!canMutate()) return;
        
        Swal.fire({
            title: 'Release Case?',
            text: "This will set the case status back to Unassigned and allow other analysts to claim it.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            confirmButtonText: 'Yes, release it!',
            background: '#151f32',
            color: '#fff'
        }).then(async (res) => {
            if (res.isConfirmed) {
                try {
                    const actionResult = executeUnifiedAction("assign_case", {
                        caseId: selectedCaseId,
                        assignedTo: "Unassigned",
                        analyst: userDisplayName(getCurrentUser()),
                    });

                    if (actionResult) {
                        const next = caseList.map((c) =>
                            c.id === selectedCaseId
                                ? {
                                    ...c,
                                    assignedTo: "Unassigned",
                                    isMine: false,
                                }
                                : c
                        );
                        persistCaseList(next);

                        updateSelectedCaseState((cur) => ({
                            ...cur,
                            assignedTo: "Unassigned",
                            isMine: false,
                        }));

                        pushNotification(`Case ${selectedCaseId} has been released (unassigned)`);
                        await syncWithBackend();
                    }
                } catch (error) {
                    console.error("Failed to release case:", error);
                    pushNotification(`Failed to release case: ${error.message || error}`);
                }
            }
        });
    };

    const handleEscalateSubmit = () => {
        if (!canMutate()) return;
        const reason = (escalateReason || "").trim();
        if (!reason || escalateBusy) return;
        setEscalateBusy(true);

        const result = executeUnifiedAction("escalate_case", {
            caseId: selectedCaseId,
            level: escalateLevel,
            assignee: escalateAssignee,
            reason,
            analyst: userDisplayName(getCurrentUser()),
        });

        if (result) {
            // Update caseList with escalation and persist to store
            const next = caseList.map((c) =>
                c.id === selectedCaseId
                    ? {
                        ...c,
                        status: "escalated",
                        assignedTo: escalateAssignee,
                        pending: true,
                        escalated: true,
                        escalatedTo: escalateLevel,
                        escalationReason: reason,
                    }
                    : c
            );
            persistCaseList(next);

            // Update local state
            updateSelectedCaseState((cur) => ({
                ...cur,
                assignedTo: escalateAssignee,
                pending: true,
                currentStatus: "Escalated",
                activePhase: "triage",
                currentPhase: "Investigation Phase",
            }));

            pushNotification(`Case ${selectedCaseId} escalated to ${escalateLevel}`);
            syncWithBackend().catch(err => console.error("Sync after escalation failed:", err));
        }

        setEscalateOpen(false);
        setEscalateReason("");
        setEscalateBusy(false);
    };

    // Single source of truth: merge caseList with live caseStates
    const mergedCases = useMemo(() => {
        return caseList.map(c => ({
            ...c,
            ...(caseStates[c.id] || {})
        }));
    }, [caseList, caseStates]);

    const baseVisibleCases = useMemo(() => {
        const u = getCurrentUser();
        const isAdminUser = u?.roleType === "admin" || getRole() === "admin";
        if (isAdminUser) return mergedCases;

        const nm = userDisplayName(u).trim().toLowerCase();
        const em = (u?.email || "").trim().toLowerCase();
        return mergedCases.filter((c) => {
            const isCaseUnassigned = !c.assignedTo || c.assignedTo === "Unassigned" || c.assignedTo === "";
            if (isCaseUnassigned) return true;
            if (c.isMine) return true;
            if (c.assignedTo === "CURRENT_USER") return true;
            const r = resolveAssign(c.assignedTo);
            const rl = String(r || "").trim().toLowerCase();
            return rl === nm || (!!em && rl === em);
        });
    }, [mergedCases]);

    const filteredCases = useMemo(() => {
        let list = baseVisibleCases;
        const q = caseSearch.trim().toLowerCase();
        if (q) list = list.filter((c) => c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q));

        if (caseViewFilter === "mine") {
            const u = getCurrentUser();
            const nm = userDisplayName(u).trim().toLowerCase();
            const em = (u?.email || "").trim().toLowerCase();
            list = list.filter((c) => {
                if (c.isMine) return true;
                if (c.assignedTo === "CURRENT_USER") return true;
                if (!c.assignedTo) return false;
                const r = resolveAssign(c.assignedTo);
                const rl = String(r || "").trim().toLowerCase();
                return rl === nm || (!!em && rl === em);
            });
        }

        if (caseViewFilter === "high") {
            list = list.filter((c) => {
                const sev = String(c.severity || c.priority || "").toLowerCase();
                return sev === "critical" || sev === "high";
            });
        }

        if (caseViewFilter === "pending") {
            list = list.filter((c) => {
                if (c.pending === true) return true;
                const status = String(c.status || "").toLowerCase();
                if (status === "pending") return true;
                const reviewStatus = String(c.reviewStatus || "").toLowerCase();
                if (reviewStatus === "pending") return true;
                return false;
            });
        }

        if (caseViewFilter === "archived") {
            list = list.filter((c) => {
                if (c.archived === true) return true;
                const status = String(c.status || "").toLowerCase();
                if (status === "closed") return true;
                if (c.closedAt) return true;
                return false;
            });
        }

        return list;
    }, [baseVisibleCases, caseSearch, caseViewFilter]);

    const filterCounts = useMemo(() => {
        const u = getCurrentUser();
        const nm = userDisplayName(u).trim().toLowerCase();
        const em = (u?.email || "").trim().toLowerCase();

        // My Assignments: assignedTo exists OR isMine === true
        const mine = baseVisibleCases.filter((c) => {
            if (c.isMine) return true;
            if (c.assignedTo === "CURRENT_USER") return true;
            if (!c.assignedTo) return false;
            const r = resolveAssign(c.assignedTo);
            const rl = String(r || "").trim().toLowerCase();
            return rl === nm || (!!em && rl === em);
        }).length;

        // High Priority: severity/priority === "critical" OR "high"
        const high = baseVisibleCases.filter((c) => {
            const sev = String(c.severity || c.priority || "").toLowerCase();
            return sev === "critical" || sev === "high";
        }).length;

        // Pending Review: pending === true OR status === "pending" OR reviewStatus === "pending"
        const pending = baseVisibleCases.filter((c) => {
            if (c.pending === true) return true;
            const status = String(c.status || "").toLowerCase();
            if (status === "pending") return true;
            const reviewStatus = String(c.reviewStatus || "").toLowerCase();
            if (reviewStatus === "pending") return true;
            return false;
        }).length;

        // Archived: archived === true OR status === "closed" OR closedAt exists
        const archived = baseVisibleCases.filter((c) => {
            if (c.archived === true) return true;
            const status = String(c.status || "").toLowerCase();
            if (status === "closed") return true;
            if (c.closedAt) return true;
            return false;
        }).length;

        return { mine, high, pending, archived };
    }, [baseVisibleCases]);

    const systemStatus = useMemo(() => {
        const criticalOpen = mergedCases.some(
            c =>
                (c.priority === "critical" || c.severity === "critical") &&
                c.status !== "closed"
        );

        const breached = mergedCases.some(
            c => c?.slaBreach
        );

        const escalated = mergedCases.some(
            c => c.escalated
        );

        const pendingCount = mergedCases.filter(
            c => c.pending
        ).length;

        if (breached || criticalOpen || escalated) {
            return {
                label: "Incident Active",
                color: "red",
                dot: "🔴"
            };
        }

        if (pendingCount >= 5) {
            return {
                label: "Degraded",
                color: "yellow",
                dot: "🟡"
            };
        }

        return {
            label: "Operational",
            color: "green",
            dot: "🟢"
        };
    }, [mergedCases]);

    const handleNewCase = () => {
        if (!canMutate()) return;
        const incidents = getIncidents();
        if (!incidents || !incidents.length) {
            Swal.fire({
                title: 'No Incidents',
                text: 'Please create cases directly from incidents list.',
                icon: 'warning',
                background: '#121f28',
                color: '#fff',
                confirmButtonColor: '#2badee'
            });
            return;
        }

        const existingCases = getCases();
        const availableIncidents = incidents.filter(
            (inc) => !existingCases.some((c) => String(c.incidentId) === String(inc.id))
        );

        if (availableIncidents.length === 0) {
            Swal.fire({
                title: 'No Available Incidents',
                text: 'All active incidents already have associated cases. You can view them in the Incidents tab.',
                icon: 'info',
                background: '#121f28',
                color: '#fff',
                confirmButtonColor: '#2badee'
            });
            return;
        }

        const optionsHtml = availableIncidents.map((inc) => {
            const label = `[${String(inc.severity || 'high').toUpperCase()}] ${inc.title || 'Incident ' + inc.id} (${inc.id})`;
            return `<option value="${inc.id}">${label}</option>`;
        }).join('');

        Swal.fire({
            title: 'Create Case from Incident',
            html: `
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Select Incident to Triage</label>
                    <select id="swal-select-incident" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px; height: auto;">
                        ${optionsHtml}
                    </select>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Create Case',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#2badee',
            cancelButtonColor: '#1a2c38',
            customClass: {
                popup: 'swal-enterprise-dark',
            },
            preConfirm: () => {
                const selectEl = document.getElementById('swal-select-incident');
                return selectEl ? selectEl.value : null;
            }
        }).then(async (result) => {
            if (result.isConfirmed && result.value) {
                const selectedIncId = result.value;
                const incident = availableIncidents.find((inc) => String(inc.id) === String(selectedIncId));
                if (incident) {
                    try {
                        Swal.fire({
                            title: 'Creating Case...',
                            text: 'Initializing case triage workflow on the SOC backend.',
                            allowOutsideClick: false,
                            didOpen: () => {
                                Swal.showLoading();
                            }
                        });
                        const createdCase = await createCaseFromIncident(incident);
                        if (createdCase) {
                            setSelectedCaseId(createdCase.id);
                            setCaseViewFilter("all");
                            Swal.close();
                            pushNotification(`New case ${createdCase.id} successfully created and synced.`);
                        }
                    } catch (err) {
                        Swal.fire({
                            title: 'Error Creating Case',
                            text: err.message || 'Failed to create case on backend.',
                            icon: 'error',
                            background: '#121f28',
                            color: '#fff',
                            confirmButtonColor: '#ef4444'
                        });
                    }
                }
            }
        });
    };

    useEffect(() => {
        if (!filteredCases.length) return;
        if (!filteredCases.some((c) => c.id === selectedCaseId)) {
            setSelectedCaseId(filteredCases[0].id);
        }
    }, [filteredCases, selectedCaseId]);

    useEffect(() => {
        const fresh = getCases();
        setCaseList(fresh);
        setCaseStates((prev) => {
            const next = {};
            fresh.forEach((c) => {
                next[c.id] = prev[c.id]
                    ? { 
                        ...prev[c.id], 
                        archived: c.archived, 
                        pending: c.pending, 
                        assignedTo: c.assignedTo, 
                        isMine: c.isMine, 
                        priority: c.priority,
                        auditLog: mergeAuditLogs(prev[c.id].auditLog || [], buildInitialAuditLog(c)).map((x) => ({ ...x, id: x.id }))
                      }
                    : buildCaseStateRow(c);
            });
            return next;
        });
        if (location.state?.caseId) {
            setSelectedCaseId(location.state.caseId);
            setHighlightedCaseId(location.state.caseId);

            setTimeout(() => {
                setHighlightedCaseId(null);
            }, 2000);
        }
    }, [location.state]);

    useEffect(() => {
        const handlePlatformData = () => {
            const fresh = getCases();
            setCaseList(fresh);
            setCaseStates((prev) => {
                const next = {};
                fresh.forEach((c) => {
                    next[c.id] = prev[c.id]
                        ? {
                            ...prev[c.id],
                            archived: c.archived,
                            pending: c.pending,
                            assignedTo: c.assignedTo,
                            isMine: c.isMine,
                            priority: c.priority,
                            auditLog: mergeAuditLogs(prev[c.id].auditLog || [], buildInitialAuditLog(c)).map((x) => ({ ...x, id: x.id }))
                        }
                        : buildCaseStateRow(c);
                });
                return next;
            });
        };

        window.addEventListener("soc_platform_data", handlePlatformData);
        return () => window.removeEventListener("soc_platform_data", handlePlatformData);
    }, []);

    useEffect(() => {
        if (!showConfirm && !assignOpen && !escalateOpen && !classifyOpen) return;
        const esc = (e) => {
            if (e.key !== "Escape") return;
            setShowConfirm(false);
            setAssignOpen(false);
            setEscalateOpen(false);
            setClassifyOpen(false);
        };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [showConfirm, assignOpen, escalateOpen, classifyOpen]);

    // Debug: Log state synchronization
    useEffect(() => {
        console.log({
            caseViewFilter,
            totalCases: caseList.length,
            filtered: filteredCases.length,
            counts: filterCounts,
            selectedCaseId,
        });
    }, [caseViewFilter, caseList.length, filteredCases.length, filterCounts, selectedCaseId]);

    // Check for malicious IOCs and auto-escalate
    useEffect(() => {
        const updated = caseList.map(c => {
            const escalated = checkAndEscalateMaliciousIoc(c);
            if (escalated && escalated !== c) {
                addAuditLog({
                    action: AUDIT_ACTIONS.MALICIOUS_IOC_DETECTED,
                    severity: AUDIT_SEVERITY.CRITICAL,
                    caseId: c.id,
                    message: `Case auto-escalated due to malicious IOC detection`,
                    entity: "case",
                    entityId: c.id
                });
                pushNotification(`Case ${c.id} auto-escalated - Malicious IOC detected`, { category: "security" });
                return escalated;
            }
            return c;
        });

        if (updated.some((c, i) => c !== caseList[i])) {
            setCases(updated);
            window.dispatchEvent(new Event("soc_system_refresh"));
        }
    }, [caseList]);

    const handleExportAuditReport = () => {
        const payload = {
            caseId: selectedCaseId,
            exportedAt: new Date().toISOString(),
            caseTitle: selectedCase?.title || "—",
            auditLog: auditLog.map(({ id, title, at, type }) => ({ id, title, at, type })),
            status: currentStatus,
            phase: currentPhase,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `case-audit-${selectedCaseId.replace(/[^a-z0-9-]/gi, "_")}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const handleShareCase = () => {
        try {
            if (!selectedUser.trim()) {
                pushNotification("Please enter a user");
                return;
            }

            const storedCases = getCases();

            const updatedCases = storedCases.map((c) => {
                if (c.id === selectedCase.id) {
                    return {
                        ...c,
                        sharedWith: [
                            ...(c.sharedWith || []),
                            {
                                user: selectedUser,
                                permission: selectedPermission,
                                message: shareMessage,
                                sharedAt: Date.now(),
                            },
                        ],
                    };
                }
                return c;
            });

            setCases(updatedCases);

            const updatedSelectedCase = {
                ...selectedCase,
                sharedWith: [
                    ...(selectedCase.sharedWith || []),
                    {
                        user: selectedUser,
                        permission: selectedPermission,
                        message: shareMessage,
                        sharedAt: Date.now(),
                    },
                ],
            };

            setCaseList((prev) =>
                prev.map((c) => (c.id === selectedCase.id ? updatedSelectedCase : c))
            );

            addAuditLog({
                action: AUDIT_ACTIONS.CASE_ASSIGNED,
                severity: AUDIT_SEVERITY.INFO,
                message: `Case shared with ${selectedUser} (${selectedPermission})`,
                entity: "case",
                entityId: selectedCase.id,
                caseId: selectedCase.id,
            });

            setSelectedUser("");
            setSelectedPermission("View");
            setShareMessage("");
            setShareModalOpen(false);

            pushNotification("Case shared successfully");
        } catch (error) {
            console.error("Share failed:", error);
            pushNotification("Failed to share case");
        }
    };

    const handleDeleteCase = () => {
        if (!canMutate()) return;
        
        Swal.fire({
            title: 'Delete Case?',
            text: `Are you sure you want to remove ${selectedCaseId} from your active dashboard view?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Delete',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#1a2c38',
            customClass: {
                popup: 'swal-enterprise-dark',
            }
        }).then((result) => {
            if (result.isConfirmed) {
                const delId = selectedCaseId;
                setCaseList((prev) => {
                    const next = prev.filter((x) => x.id !== delId);
                    setCases(next);
                    const nextId = next[0]?.id || "";
                    if (nextId && nextId !== delId) setSelectedCaseId(nextId);
                    return next;
                });
                setCaseStates((prev) => {
                    const next = { ...prev };
                    delete next[delId];
                    return next;
                });
                pushAudit({ action: "delete", entityType: "case", entityId: delId, message: "Deleted case" });
                pushNotification(`Case ${delId} deleted`);
            }
        });
    };

    return (
        <div className="cases-page">

            {/* TOPBAR */}
            <header className="cases-topbar">
                <div className="cases-topbar-left">
                    <div className="cases-logo">
                        <SocLogo />
                    </div>
                    {(() => {
                        const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
                        const roleType = (user.roleType || "analyst").toLowerCase();
                        return (
                            <nav className="cases-topnav">
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
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#92b7c9" }}>
                        <span>System Status:</span>
                        <span style={{ fontSize: "16px" }}>{systemStatus.dot}</span>
                        <span>{systemStatus.label}</span>
                    </div>
                </div>
                <div className="cases-topbar-right">
                    <div className="cases-search-box">
                        <Search size={16} />
                        <input
                            type="text"
                            placeholder="Search cases..."
                            value={caseSearch}
                            onChange={(e) => setCaseSearch(e.target.value)}
                        />
                    </div>
                    <div className="cases-top-icons">
                        <HeaderNotificationBell className="cases-icon-btn">
                            <Bell size={18} />
                        </HeaderNotificationBell>
                        <HeaderSettingsNav className="cases-icon-btn">
                            <Settings size={18} />
                        </HeaderSettingsNav>
                    </div>
                    <HeaderMenuAvatar
                        className="cases-avatar"
                        onLogout={() => { logoutSession(); navigate("/"); }}
                    />
                </div>
            </header>

            <main className="cases-main-layout">

                {/* SIDEBAR */}
                <aside className="cases-sidebar">
                    <div className="cases-sidebar-inner">
                        <div className="cases-sidebar-header">
                            <h1>Case Manager</h1>
                            <span className="cases-count">{caseList.length} Total</span>
                        </div>
                        <button type="button" className="cases-new-btn" onClick={handleNewCase} disabled={!canMutate()}><PlusCircle size={16} />New Case</button>

                        <div className="cases-list">
                            {filteredCases.length === 0 ? (
                                selectedCase ? (
                                    (() => {
                                        const isCaseUnassigned = !selectedCase.assignedTo || selectedCase.assignedTo === "Unassigned" || selectedCase.assignedTo === "";
                                        const isSharedWithMe = selectedCase.sharedWith && selectedCase.sharedWith.some(s => 
                                            (s.user || "").trim().toLowerCase() === meName.toLowerCase() ||
                                            (meEmail && (s.user || "").trim().toLowerCase() === meEmail.toLowerCase())
                                        );
                                        return (
                                            <div className={`cases-list-item active`}>
                                                <FolderOpen size={18} className="cases-list-icon active" />
                                                <div className="cases-list-info">
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <p className="cases-list-id">{selectedCase.id}</p>
                                                        {isCaseUnassigned && (
                                                            <span className="cases-unassigned-badge" style={{
                                                                fontSize: "9px",
                                                                fontWeight: "bold",
                                                                textTransform: "uppercase",
                                                                color: "#ef4444",
                                                                border: "1px dashed rgba(239, 68, 68, 0.4)",
                                                                padding: "1px 4px",
                                                                borderRadius: "3px",
                                                                background: "rgba(239, 68, 68, 0.05)",
                                                                lineHeight: "1"
                                                            }}>
                                                                Unassigned
                                                            </span>
                                                        )}
                                                        {isSharedWithMe && (
                                                            <span className="cases-shared-badge" style={{
                                                                fontSize: "9px",
                                                                fontWeight: "bold",
                                                                textTransform: "uppercase",
                                                                color: "#10b981",
                                                                border: "1px dashed rgba(16, 185, 129, 0.4)",
                                                                padding: "1px 4px",
                                                                borderRadius: "3px",
                                                                background: "rgba(16, 185, 129, 0.05)",
                                                                lineHeight: "1"
                                                            }}>
                                                                Shared
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span>{selectedCase.title}</span>
                                                </div>
                                                <div className={`cases-status-dot ${selectedCase.dot}`} />
                                            </div>
                                        );
                                    })()
                                ) : (
                                    <p className="cases-note" style={{ padding: "12px 16px" }}>No data available</p>
                                )
                            ) : filteredCases.slice((casePage - 1) * 10, casePage * 10).map((c) => {
                                const isCaseUnassigned = !c.assignedTo || c.assignedTo === "Unassigned" || c.assignedTo === "";
                                const isSharedWithMe = c.sharedWith && c.sharedWith.some(s => 
                                    (s.user || "").trim().toLowerCase() === meName.toLowerCase() ||
                                    (meEmail && (s.user || "").trim().toLowerCase() === meEmail.toLowerCase())
                                );
                                return (
                                    <div
                                        key={c.id}
                                        className={`cases-list-item case-row ${selectedCaseId === c.id ? "active" : ""} ${highlightedCaseId === c.id ? "highlight" : ""}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedCaseId(c.id)}
                                        onKeyDown={(e) => e.key === "Enter" && setSelectedCaseId(c.id)}
                                    >
                                        {selectedCaseId === c.id ? <FolderOpen size={18} className="cases-list-icon active" /> : <Folder size={18} className="cases-list-icon" />}
                                        <div className="cases-list-info">
                                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                <p className="cases-list-id">{c.id}</p>
                                                {isCaseUnassigned && (
                                                    <span className="cases-unassigned-badge" style={{
                                                        fontSize: "9px",
                                                        fontWeight: "bold",
                                                        textTransform: "uppercase",
                                                        color: "#ef4444",
                                                        border: "1px dashed rgba(239, 68, 68, 0.4)",
                                                        padding: "1px 4px",
                                                        borderRadius: "3px",
                                                        background: "rgba(239, 68, 68, 0.05)",
                                                        lineHeight: "1"
                                                    }}>
                                                        Unassigned
                                                    </span>
                                                )}
                                                {isSharedWithMe && (
                                                    <span className="cases-shared-badge" style={{
                                                        fontSize: "9px",
                                                        fontWeight: "bold",
                                                        textTransform: "uppercase",
                                                        color: "#10b981",
                                                        border: "1px dashed rgba(16, 185, 129, 0.4)",
                                                        padding: "1px 4px",
                                                        borderRadius: "3px",
                                                        background: "rgba(16, 185, 129, 0.05)",
                                                        lineHeight: "1"
                                                    }}>
                                                        Shared
                                                    </span>
                                                )}
                                            </div>
                                            <span>{c.title}</span>
                                        </div>
                                        <div className={`cases-status-dot ${c.dot}`} />
                                    </div>
                                );
                            })}
                        </div>

                        {/* PAGINATION */}
                        {filteredCases.length > 10 && (
                            <div className="cases-pagination" style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 16px",
                                borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                                fontSize: "11px",
                                color: "#94a3b8",
                                background: "rgba(255, 255, 255, 0.01)"
                            }}>
                                <button
                                    type="button"
                                    onClick={() => setCasePage(p => Math.max(1, p - 1))}
                                    disabled={casePage === 1}
                                    style={{
                                        background: "transparent",
                                        border: "none",
                                        color: casePage === 1 ? "rgba(255, 255, 255, 0.15)" : "#3b82f6",
                                        cursor: casePage === 1 ? "not-allowed" : "pointer",
                                        padding: "2px 6px",
                                        fontWeight: "600"
                                    }}
                                >
                                    &larr; Prev
                                </button>
                                <span style={{ fontFamily: "monospace" }}>Page {casePage} of {Math.ceil(filteredCases.length / 10)}</span>
                                <button
                                    type="button"
                                    onClick={() => setCasePage(p => Math.min(Math.ceil(filteredCases.length / 10), p + 1))}
                                    disabled={casePage === Math.ceil(filteredCases.length / 10)}
                                    style={{
                                        background: "transparent",
                                        border: "none",
                                        color: casePage === Math.ceil(filteredCases.length / 10) ? "rgba(255, 255, 255, 0.15)" : "#3b82f6",
                                        cursor: casePage === Math.ceil(filteredCases.length / 10) ? "not-allowed" : "pointer",
                                        padding: "2px 6px",
                                        fontWeight: "600"
                                    }}
                                >
                                    Next &rarr;
                                </button>
                            </div>
                        )}

                        <div className="cases-views">
                            <p className="cases-views-title">Views</p>
                            <div
                                className={`cases-view-item ${caseViewFilter === "mine" ? "active" : ""}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setCaseViewFilter("mine")}
                                onKeyDown={(e) => e.key === "Enter" && setCaseViewFilter("mine")}
                            >
                                <User size={16} />
                                <p>My Assignments</p>
                                <span className="cases-view-count">{filterCounts.mine}</span>
                            </div>
                            <div
                                className={`cases-view-item ${caseViewFilter === "high" ? "active" : ""}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setCaseViewFilter("high")}
                                onKeyDown={(e) => e.key === "Enter" && setCaseViewFilter("high")}
                            >
                                <AlertTriangle size={16} />
                                <p>High Priority</p>
                                <span className="cases-view-count">{filterCounts.high}</span>
                            </div>
                            <div
                                className={`cases-view-item ${caseViewFilter === "pending" ? "active" : ""}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setCaseViewFilter("pending")}
                                onKeyDown={(e) => e.key === "Enter" && setCaseViewFilter("pending")}
                            >
                                <Clock size={16} />
                                <p>Pending Review</p>
                                <span className="cases-view-count">{filterCounts.pending}</span>
                            </div>
                            <div
                                className={`cases-view-item ${caseViewFilter === "archived" ? "active" : ""}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setCaseViewFilter("archived")}
                                onKeyDown={(e) => e.key === "Enter" && setCaseViewFilter("archived")}
                            >
                                <Archive size={16} />
                                <p>Archived</p>
                                <span className="cases-view-count">{filterCounts.archived}</span>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* MAIN CONTENT */}
                <section className="cases-content">

                    {/* PAGE HEADER */}
                    <div className="cases-detail-header">
                        <div className="cases-detail-top">
                            <div className="cases-detail-info">
                                <div className="cases-detail-meta">
                                    <span className="cases-severity">{selectedCase?.severityLabel || "—"}</span>
                                    <p className="cases-opened">Opened {selectedCase?.createdAt ? formatTime(selectedCase.createdAt) : "—"} by {selectedCase?.openedBy || "—"}</p>
                                </div>
                                <h1 className="cases-detail-title">Case: {selectedCaseId}</h1>

                                <div className="cases-progress-bar">
                                    {PHASES.map(p => (
                                        <span key={p} className={`cases-phase ${p === activePhase ? "active-blue" : ""}`}>
                                            {p.charAt(0).toUpperCase() + p.slice(1)}
                                        </span>
                                    ))}
                                </div>

                                <div className="cases-correlation-tags">
                                    <span className="cases-tag wazuh">WAZUH</span>
                                    <span className="cases-tag sysmon">SYSMON</span>
                                    <span className="cases-tag ml">NETWORK ML</span>
                                </div>

                                <p className="cases-description">{selectedCase?.description || "No data available"}</p>
                                <p className="cases-note">{selectedCase?.note || ""}</p>
                            </div>

                            <div className="cases-detail-actions">
                                <button type="button" className="cases-export-btn" onClick={handleExportAuditReport}><FileText size={16} />Export Audit Report</button>
                                <button className="cases-menu-btn">⋮</button>
                            </div>
                        </div>
                    </div>

                    {/* MITRE */}
                    <div className="cases-mitre-section">
                        <div className="cases-mitre-container">
                            <div className="cases-mitre-header">
                                <div>
                                    <h3 className="cases-mitre-title">MITRE ATT&CK Mapping</h3>
                                    <p className="cases-mitre-subtitle">Mapped automatically via detection correlation engine</p>
                                </div>
                                <div className="cases-mitre-confidence">Confidence: {selectedCase?.confidence != null ? `${selectedCase.confidence}%` : "—"}</div>
                            </div>
                            <div className="cases-mitre-grid">
                                {mitre.length ? mitre.map((m, index) => {
                                    const id = typeof m === "string" ? m : m?.id;
                                    const name = typeof m === "string" ? "" : m?.name;
                                    const tactic = typeof m === "string" ? "" : m?.tactic;
                                    return (
                                        <div key={`${id}-${tactic}-${index}`} className="cases-mitre-card">
                                            <div className="cases-mitre-id">{id}</div>
                                            {name && <div className="cases-mitre-name">{name}</div>}
                                            {tactic && <div className="cases-mitre-tactic">Tactic: {tactic}</div>}
                                        </div>
                                    );
                                }) : (
                                    <div className="cases-mitre-card mitre-faded">
                                        <p className="cases-mitre-id">No MITRE techniques detected</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* RESPONSE ACTIONS */}
                    <div className="cases-response-section">
                        <h3 className="cases-response-title">Incident Response Actions</h3>
                        <div className="cases-response-grid">

                            <div className="cases-response-card">
                                <p className="cases-card-title text-red">Containment</p>
                                <div className="cases-card-btns">
                                    <button className="cases-action-btn" onClick={() => simulateResponse("isolate")} disabled={!canMutate()}>Isolate Host</button>
                                    <button className="cases-action-btn" onClick={() => simulateResponse("kill_process")} disabled={!canMutate()}>Kill Process</button>
                                    <button className="cases-action-btn" onClick={() => simulateResponse("disable_user")} disabled={!canMutate()}>Disable User</button>
                                </div>
                            </div>

                            <div className="cases-response-card">
                                <p className="cases-card-title text-yellow">Network</p>
                                <div className="cases-card-btns">
                                    <button className="cases-action-btn" onClick={() => simulateResponse("block_ip")} disabled={!canMutate()}>Block IP</button>
                                    <button className="cases-action-btn" onClick={() => simulateResponse("block_domain")} disabled={!canMutate()}>Block Domain</button>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* STATS */}
                    <div className="cases-stats-row">
                        <div className="cases-stat-card">
                            <div className="cases-stat-header">
                                <p>Linked Incidents</p>
                                <Link size={16} color="#2badee" />
                            </div>
                            <h2>{selectedCase?.alertIds?.length || 0} Alerts</h2>
                            <div className="cases-stat-trend">
                                {selectedCase?.incidentId ? (
                                    <button
                                        type="button"
                                        style={{
                                            background: "none",
                                            border: "none",
                                            color: "#2badee",
                                            cursor: "pointer",
                                            textDecoration: "underline",
                                            fontSize: 14,
                                            padding: 0,
                                        }}
                                        onClick={() => navigate("/incident", { state: { incidentId: selectedCase.incidentId } })}
                                    >
                                        {selectedCase.incidentId}
                                    </button>
                                ) : (
                                    <p>No linked incident</p>
                                )}
                            </div>
                        </div>

                        <div className="cases-stat-card">
                            <div className="cases-stat-header">
                                <p>Current Status</p>
                            </div>
                            <div className="cases-status-tags">
                                <span className="cases-tag red">Initial Access</span>
                                <span className="cases-tag yellow">Lateral Movement</span>
                                <span className="cases-tag blue">C2 Active</span>
                            </div>
                            <h2 id="currentStatus">{currentStatus}</h2>
                            <p className="cases-phase-label">{currentPhase}</p>
                        </div>

                        <div className="cases-stat-card">
                            <div className="cases-stat-header">
                                <p>SLA Timer</p>
                                <Clock size={16} color="#facc15" />
                            </div>
                            {(() => {
                                const totalSeconds = getSlaDuration(selectedCase?.priority);
                                const currentSeconds = slaTime.h * 3600 + slaTime.m * 60 + slaTime.s;
                                const percentRemaining = totalSeconds > 0 ? (currentSeconds / totalSeconds) * 100 : 0;
                                const isLowTime = percentRemaining > 0 && percentRemaining < 20;
                                return (
                                    <>
                                        <h2 className={`cases-timer ${slaBreach ? "breached" : isLowTime ? "low-time" : ""}`}>
                                            {pad(slaTime.h)}:{pad(slaTime.m)}:{pad(slaTime.s)}
                                        </h2>
                                        <p className={`cases-deadline ${slaBreach ? "breached" : ""}`}>
                                            {slaBreach ? "SLA BREACHED" : isLowTime ? "⚠ Low Time" : "Approaching Deadline"}
                                        </p>
                                    </>
                                );
                            })()}
                            </div>
                    </div>

                    {/* ACTIONS BAR */}
                    <div className="cases-actions-bar">
                        {[
                            { icon: <CheckCircle size={20} />, label: "Close Case", onClick: handleCloseCase },
                            { icon: <RotateCcw size={20} />, label: "Resume", onClick: handleResume },
                            {
                                icon: <UserPlus size={20} />,
                                label: "Assign",
                                onClick: () => {
                                    setShowConfirm(false);
                                    setClassifyOpen(false);
                                    setEscalateOpen(false);
                                    setAssignTarget(userDisplayName(getCurrentUser()));
                                    setAssignOpen(true);
                                },
                            },
                            // Only show Release if case is currently assigned and not closed
                            ...(selectedState.assignedTo && selectedState.assignedTo !== "Unassigned" && selectedState.assignedTo !== "" && selectedState.currentStatus !== "Closed" ? [
                                { icon: <UserMinus size={20} />, label: "Release", onClick: handleReleaseCase }
                            ] : []),
                            // Only show Share if case is assigned to current user (me)
                            ...(selectedState.assignedTo === userDisplayName(getCurrentUser()) || selectedState.isMine ? [
                                { icon: <Share2 size={20} />, label: "Share", onClick: () => setShareModalOpen(true) }
                            ] : []),
                            {
                                icon: <Flag size={20} />,
                                label: "Escalate",
                                onClick: () => {
                                    setShowConfirm(false);
                                    setAssignOpen(false);
                                    setClassifyOpen(false);
                                    setEscalateLevel("L2");
                                    setEscalateReason("");
                                    setEscalateOpen(true);
                                },
                            },
                            { icon: <Trash2 size={20} />, label: "Delete", danger: true, onClick: handleDeleteCase },
                        ].map((item, i) => (
                            <button
                                key={i}
                                className={`cases-action-item ${item.danger ? "delete" : ""}`}
                                onClick={item.onClick}
                            >
                                {item.icon}
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* NOTES + AUDIT */}
                    <div className="cases-investigation-grid">

                        <div className="cases-notes-section">
                            <div className="cases-notes-header">
                                <h3><FileText size={18} />Analyst Notes</h3>
                                <button className="cases-history-btn"><History size={14} />View History</button>
                            </div>
                            <div className="cases-notes-card">
                                <div className="cases-notes-toolbar">
                                    <button><Bold size={14} /></button>
                                    <button><Italic size={14} /></button>
                                    <button><List size={14} /></button>
                                    <div className="cases-toolbar-divider" />
                                    <button><Paperclip size={14} /></button>
                                </div>
                                    <textarea
                                        placeholder="Document findings, IOCs, and coordination details here..."
                                        value={noteDraft}
                                        onChange={(e) => updateSelectedCaseState((cur) => ({ ...cur, noteDraft: e.target.value }))}
                                        disabled={!canMutate()}
                                    />
                                <div className="cases-notes-footer">
                                        <p>
                                            Last saved: {selectedState.lastSavedAt ? formatTime(selectedState.lastSavedAt) : "—"} by {resolveAssign(selectedState.assignedTo) || selectedCase?.openedBy}
                                        </p>
                                        <button type="button" className="cases-save-btn" onClick={handleSaveNote} disabled={!canMutate() || saveNoteBusy}>Save Note</button>
                                </div>
                            </div>
                        </div>

                        <div className="cases-audit-section">
                            <div className="cases-audit-header">
                                <h3><History size={18} />Actions Taken (Audit Log)</h3>
                                <button className="cases-audit-log-btn">Full Log</button>
                            </div>
                            <div className="cases-audit-card">
                                <div className="cases-audit-timeline">
                                    {auditLog.map(item => (
                                        <div key={item.id} className="cases-audit-item">
                                            <div className={`cases-audit-icon ${item.type}`}>{item.icon}</div>
                                            <div className="cases-audit-content">
                                                <div className="cases-audit-top">
                                                    <p className="cases-audit-title">{item.title}</p>
                                                    <span className="cases-audit-time">{item.at ? formatTime(item.at) : "—"}</span>
                                                </div>
                                                {item.text && <p className="cases-audit-text">{item.text}</p>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* METADATA */}
                    <div className="cases-metadata">
                        <div className="cases-meta-card">
                            <p className="cases-meta-title">Lead Analyst</p>
                            <div className="cases-meta-user">
                                <p>{selectedCase?.assignedTo || selectedCase?.owner || selectedCase?.openedBy || "Unassigned"}</p>
                            </div>
                        </div>
                        <div className="cases-meta-card">
                            <p className="cases-meta-title">Case Created</p>
                            <p className="cases-meta-value">{selectedCase?.createdAt ? formatTime(selectedCase.createdAt) : "—"}</p>
                        </div>
                        <div className="cases-meta-card">
                            <p className="cases-meta-title">Target Assets</p>
                            <p className="cases-meta-value">{selectedCase?.affectedMachine?.hostname || selectedCase?.ip || selectedCase?.assets || "—"}</p>
                        </div>
                        <div className="cases-meta-card">
                            <p className="cases-meta-title">Data Impact</p>
                            <p className="cases-meta-value data-red">
                                {selectedCase?.resolution === "false_positive" ? "False Positive" : selectedCase?.resolution === "true_positive" ? "Remediated" : selectedCase?.status === "closed" ? "Contained" : "Under Investigation"}
                            </p>
                        </div>
                    </div>

                    {selectedCase?.sharedWith?.length > 0 && (
                        <div style={{ marginTop: "24px" }}>
                            <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "#92b7c9" }}>
                                Shared With
                            </h3>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {selectedCase.sharedWith.map((share, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            border: "1px solid #2a3f5f",
                                            borderRadius: "6px",
                                            padding: "10px 12px",
                                            background: "#1a2332"
                                        }}
                                    >
                                        <div>
                                            <p style={{ fontWeight: "500", color: "#fff", fontSize: "13px" }}>
                                                {share.user}
                                            </p>
                                            {share.message && (
                                                <p style={{ fontSize: "11px", color: "#92b7c9", marginTop: "4px" }}>
                                                    {share.message}
                                                </p>
                                            )}
                                        </div>
                                        <div style={{ fontSize: "11px", padding: "4px 8px", borderRadius: "4px", background: "#2a3f5f", color: "#92b7c9" }}>
                                            {share.permission}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </section>
            </main>

            {/* CONFIRM MODAL */}
            {showConfirm && (
                <div
                    className="cases-modal-overlay"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowConfirm(false);
                    }}
                    onKeyDown={(e) => e.key === "Escape" && setShowConfirm(false)}
                    role="presentation"
                >
                    <div className="cases-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Confirm Action</h3>
                        <p>Are you sure you want to execute this critical response action?</p>
                        <div className="cases-modal-btns">
                            <button className="cases-modal-cancel" onClick={() => setShowConfirm(false)}>Cancel</button>
                            <button type="button" className="cases-modal-confirm" disabled={!!responseBusy} onClick={() => { setShowConfirm(false); executeAction(pendingAction); }}>Execute</button>
                        </div>
                    </div>
                </div>
            )}

            {classifyOpen && (
                <ClassifyModal
                    incident={incidentForClassifyModal}
                    incidentId={selectedCaseId}
                    initialSelected={classifyInitial}
                    onClose={() => setClassifyOpen(false)}
                    onConfirm={handleClassifyConfirm}
                />
            )}

            {assignOpen && (
                <div
                    className="cases-modal-overlay"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setAssignOpen(false);
                    }}
                >
                    <div className="cases-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Assign Case</h3>
                        <p>Assign this case to the current SOC user.</p>
                        <label style={{ display: "block", marginTop: 10, color: "#92b7c9" }}>
                            Assignee
                        </label>
                        <select
                            value={assignTarget}
                            onChange={(e) => setAssignTarget(e.target.value)}
                            style={{ width: "100%", marginTop: 6 }}
                        >
                            <option value={userDisplayName(getCurrentUser())}>
                                {userDisplayName(getCurrentUser())}
                            </option>
                            {isAdmin() && (
                                <>
                                    <option value="Alex Wright">Alex Wright</option>
                                    <option value="Jordan Lee">Jordan Lee</option>
                                    <option value="SOC Lead">SOC Lead</option>
                                </>
                            )}
                        </select>
                        <div className="cases-modal-btns" style={{ marginTop: 16 }}>
                            <button className="cases-modal-cancel" onClick={() => setAssignOpen(false)} type="button">
                                Cancel
                            </button>
                            <button
                                className="cases-modal-confirm"
                                onClick={handleAssignSubmit}
                                type="button"
                                disabled={assignSubmitBusy}
                            >
                                Assign
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {escalateOpen && (
                <div
                    className="cases-modal-overlay"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setEscalateOpen(false);
                    }}
                >
                    <div className="cases-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Escalate Case</h3>
                        <label style={{ display: "block", marginTop: 10, color: "#92b7c9" }}>Level</label>
                        <select value={escalateLevel} onChange={(e) => setEscalateLevel(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
                            <option value="L1">L1</option>
                            <option value="L2">L2</option>
                            <option value="L3">L3</option>
                        </select>

                        <label style={{ display: "block", marginTop: 10, color: "#92b7c9" }}>Assignee</label>
                        <select
                            value={escalateAssignee}
                            onChange={(e) => setEscalateAssignee(e.target.value)}
                            style={{ width: "100%", marginTop: 6 }}
                        >
                            <option value="SOC Lead">SOC Lead</option>
                            <option value="IR Manager">IR Manager</option>
                            <option value="CISO Staff">CISO Staff</option>
                        </select>

                        <label style={{ display: "block", marginTop: 10, color: "#92b7c9" }}>Reason</label>
                        <textarea
                            value={escalateReason}
                            onChange={(e) => setEscalateReason(e.target.value)}
                            placeholder="Escalation context…"
                            style={{ width: "100%", marginTop: 6, minHeight: 90 }}
                        />

                        <div className="cases-modal-btns" style={{ marginTop: 16 }}>
                            <button className="cases-modal-cancel" onClick={() => setEscalateOpen(false)} type="button">
                                Cancel
                            </button>
                            <button className="cases-modal-confirm" onClick={handleEscalateSubmit} type="button" disabled={escalateBusy || !(escalateReason || "").trim()}>
                                Submit
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {shareModalOpen && (
                <div
                    className="cases-modal-overlay"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShareModalOpen(false);
                    }}
                >
                    <div className="cases-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Share Case</h3>
                        <label style={{ display: "block", marginTop: 10, color: "#92b7c9" }}>
                            Share with analyst/user
                        </label>
                        <input
                            type="text"
                            value={selectedUser}
                            onChange={(e) => setSelectedUser(e.target.value)}
                            placeholder="Enter username"
                            style={{ width: "100%", marginTop: 6, padding: "8px", background: "#1a2332", border: "1px solid #2a3f5f", borderRadius: "4px", color: "#fff" }}
                        />

                        <label style={{ display: "block", marginTop: 10, color: "#92b7c9" }}>
                            Optional message
                        </label>
                        <textarea
                            value={shareMessage}
                            onChange={(e) => setShareMessage(e.target.value)}
                            placeholder="Add optional message"
                            style={{ width: "100%", marginTop: 6, padding: "8px", background: "#1a2332", border: "1px solid #2a3f5f", borderRadius: "4px", color: "#fff", minHeight: 80 }}
                        />

                        <label style={{ display: "block", marginTop: 10, color: "#92b7c9" }}>
                            Permission level
                        </label>
                        <select
                            value={selectedPermission}
                            onChange={(e) => setSelectedPermission(e.target.value)}
                            style={{ width: "100%", marginTop: 6, padding: "8px", background: "#1a2332", border: "1px solid #2a3f5f", borderRadius: "4px", color: "#fff" }}
                        >
                            <option>View</option>
                            <option>Investigate</option>
                            <option>Full Access</option>
                        </select>

                        <div className="cases-modal-btns" style={{ marginTop: 16 }}>
                            <button className="cases-modal-cancel" onClick={() => setShareModalOpen(false)} type="button">
                                Cancel
                            </button>
                            <button
                                className="cases-modal-confirm"
                                onClick={handleShareCase}
                                type="button"
                                disabled={!selectedUser.trim()}
                            >
                                Share Case
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

