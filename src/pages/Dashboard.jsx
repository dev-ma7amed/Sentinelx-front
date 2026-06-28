import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import { logoutSession } from "../session";
import { buildTrendData, getAlerts, getSeverityCounts, getTelemetry } from "../store/socStore";
import { calculateMTTR, getCases, getIncidents, syncWithBackend, debouncedSync } from "../platformStore";
import { BASE_URL } from "../api/client";
import {
    RefreshCw, Download, Bell, BellRing, Home,
    Timer, Settings, Database, Shield, Router, ClipboardList, Clock,
} from "lucide-react";
import { Chart, registerables } from "chart.js";
import { formatTime } from "../utils/formatTime";
import "../styles/Dashboard.css";
import "../styles/socLayout.css";

Chart.register(...registerables);

function isLikelyRealIp(value) {
    const v = String(value ?? "").trim();
    if (!v) return false;
    if (/^(unknown|n\/a|none|null|undefined|0\.0\.0\.0)$/i.test(v)) return false;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v)) {
        const parts = v.split(".").map(Number);
        if (parts.some((p) => p > 255)) return false;
        return true;
    }
    if (v.includes(":") && /^[0-9a-f:.]+$/i.test(v)) return true;
    return false;
}

function primaryThreatIp(a) {
    const candidate = a?.srcIP;
    if (candidate != null && isLikelyRealIp(candidate)) return String(candidate).trim();
    return "";
}

const RANGE_MS = { "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, custom: 7 * 24 * 60 * 60 * 1000 };

function windowMs(key) {
    return RANGE_MS[key] || RANGE_MS["7d"];
}

function alertTimeMs(alert) {
    const fallback = alert?.date && alert?.time ? `${alert.date}T${alert.time}` : "";
    const t = Date.parse(alert?.createdAt || fallback || "");
    return Number.isFinite(t) ? t : 0;
}

function incidentTimeMs(incident) {
    const t = Date.parse(incident?.createdAt || "");
    return Number.isFinite(t) ? t : 0;
}

function caseTimeMs(caseItem) {
    const t = Date.parse(caseItem?.createdAt || "");
    return Number.isFinite(t) ? t : 0;
}

function filterInRange(items, getTime, startMs, endMs) {
    const list = Array.isArray(items) ? items : [];
    return list.filter((item) => {
        const t = getTime(item);
        return t > 0 && t >= startMs && t <= endMs;
    });
}

function filterByTime(data, getTime, timeRangeKey, nowDate, customStartStr, customEndStr) {
    const { startMs, endMs } = resolveRangeBounds(timeRangeKey, nowDate, customStartStr, customEndStr);
    return filterInRange(data, getTime, startMs, endMs);
}

function pctChange(cur, prev) {
    if (prev <= 0) return cur > 0 ? "+100%" : "0%";
    const value = Math.round(((cur - prev) / prev) * 100);
    return `${value >= 0 ? "+" : ""}${value}%`;
}

function trendFromChange(changeStr) {
    const n = parseInt(String(changeStr).replace(/[^-\d]/g, ""), 10);
    if (Number.isNaN(n) || String(changeStr).includes("0%")) return "gray";
    return n >= 0 ? "green" : "red";
}

function resolveRangeBounds(rangeKey, lastSync, customStart, customEnd) {
    const fallbackEnd = lastSync.getTime();
    const customStartMs = Date.parse(customStart || "");
    const customEndMs = Date.parse(customEnd || "");
    if (rangeKey === "custom" && Number.isFinite(customStartMs) && Number.isFinite(customEndMs) && customEndMs >= customStartMs) {
        return {
            startMs: customStartMs,
            endMs: customEndMs,
            spanMs: Math.max(1, customEndMs - customStartMs),
        };
    }
    const spanMs = windowMs(rangeKey);
    return {
        startMs: fallbackEnd - spanMs,
        endMs: fallbackEnd,
        spanMs,
    };
}

function AttackTrendsChart({ labels, alertsData, resolvedData, refreshKey }) {
    const ref = useRef(null);
    const labs = Array.isArray(labels) && labels.length ? labels : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const chartData = labs.map((day, index) => ({ day, alerts: alertsData?.[index] ?? 0, resolved: resolvedData?.[index] ?? 0 })); /*
    const labs = hasLabels ? labelArr : ["—"];
    */ const a0 = alertsData?.length === labs.length ? alertsData : Array(labs.length).fill(0);
    const r0 = resolvedData?.length === labs.length ? resolvedData : Array(labs.length).fill(0);
    const chartSig = `${refreshKey}|${JSON.stringify(labs)}|${JSON.stringify(a0)}|${JSON.stringify(r0)}`;
    useEffect(() => {
        if (!ref.current) return undefined;
        const chart = new Chart(ref.current, {
            type: "line",
            data: {
                labels: labs,
                datasets: [
                    {
                        label: "Alerts Created",
                        data: a0,
                        borderColor: "#2badee",
                        backgroundColor: "rgba(43,173,238,0.1)",
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.45,
                        pointRadius: 3,
                        pointBackgroundColor: "#2badee",
                    },
                    {
                        label: "Incidents Closed",
                        data: r0,
                        borderColor: "#0bda57",
                        backgroundColor: "rgba(11,218,87,0.07)",
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.45,
                        pointRadius: 3,
                        pointBackgroundColor: "#0bda57",
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#111c22",
                        titleColor: "#92b7c9",
                        bodyColor: "#fff",
                        borderColor: "#233c48",
                        borderWidth: 1,
                    },
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255,255,255,0.05)" },
                        border: { display: false },
                        ticks: { color: "#92b7c9", font: { size: 10, weight: "bold" } },
                    },
                    y: {
                        grid: { color: "rgba(255,255,255,0.05)" },
                        border: { display: false },
                        ticks: { color: "#92b7c9", font: { size: 10 }, maxTicksLimit: 6 },
                    },
                },
            },
        });
        return () => chart.destroy();
    }, [chartSig, labs, a0, r0]);
    return <canvas ref={ref} />;
}

const TELEMETRY_KEYS = [
    { source: "Wazuh", label: "Host Logs (Wazuh)", icon: Database, color: "#2dd4bf" },
    { source: "Sysmon", label: "Endpoint (Sysmon)", icon: Shield, color: "#2badee" },
    { source: "Suricata", label: "Network IDS (Suricata)", icon: Router, color: "#0bda57" },
    { source: "Network ML", label: "Network Flows (ML Classification)", icon: Router, color: "#22c55e" },
];

function AttackTrendsChartFixed({ labels, alertsData, resolvedData, refreshKey }) {
    const ref = useRef(null);
    const labs = Array.isArray(labels) && labels.length ? labels : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const chartData = (Array.isArray(alertsData) && alertsData.length) || (Array.isArray(resolvedData) && resolvedData.length)
        ? labs.map((day, index) => ({
            day,
            alerts: alertsData?.[index] ?? 0,
            resolved: resolvedData?.[index] ?? 0,
        }))
        : [{ dummy: true }];
    const chartSig = `${refreshKey}|${JSON.stringify(chartData)}`;

    useEffect(() => {
        if (!ref.current) return undefined;
        const chart = new Chart(ref.current, {
            type: "line",
            data: {
                labels: chartData[0]?.dummy ? labs : chartData.map((item) => item.day),
                datasets: [
                    {
                        label: "Alerts Created",
                        data: chartData[0]?.dummy ? Array(labs.length).fill(0) : chartData.map((item) => item.alerts),
                        borderColor: "#2badee",
                        backgroundColor: "rgba(43,173,238,0.1)",
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.45,
                        pointRadius: 3,
                        pointBackgroundColor: "#2badee",
                    },
                    {
                        label: "Incidents Closed",
                        data: chartData[0]?.dummy ? Array(labs.length).fill(0) : chartData.map((item) => item.resolved),
                        borderColor: "#0bda57",
                        backgroundColor: "rgba(11,218,87,0.07)",
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.45,
                        pointRadius: 3,
                        pointBackgroundColor: "#0bda57",
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#111c22",
                        titleColor: "#92b7c9",
                        bodyColor: "#fff",
                        borderColor: "#233c48",
                        borderWidth: 1,
                    },
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255,255,255,0.05)" },
                        border: { display: false },
                        ticks: { color: "#92b7c9", font: { size: 10, weight: "bold" } },
                    },
                    y: {
                        grid: { color: "rgba(255,255,255,0.05)" },
                        border: { display: false },
                        ticks: { color: "#92b7c9", font: { size: 10 }, maxTicksLimit: 6 },
                    },
                },
            },
        });
        return () => chart.destroy();
    }, [chartSig, chartData, labs]);

    return <canvas ref={ref} />;
}

export default function Dashboard() {
    const navigate = useNavigate();
    const location = useLocation();
    const [timeRange, setTimeRange] = useState(() => localStorage.getItem("soc_dashboard_time_range") || "24h");
    const [customRangeStart, setCustomRangeStart] = useState(() => localStorage.getItem("soc_dashboard_custom_start") || "");
    const [customRangeEnd, setCustomRangeEnd] = useState(() => localStorage.getItem("soc_dashboard_custom_end") || "");
    const [dashRefresh, setDashRefresh] = useState(0);
    const [dashVersion, setDashVersion] = useState(0);
    const [liveTick, setLiveTick] = useState(0);
    const [integTick, setIntegTick] = useState(0);
    const [lastSync, setLastSync] = useState(() => new Date());
    const [refreshBusy, setRefreshBusy] = useState(false);
    const [isSseActive, setIsSseActive] = useState(false);
    const alerts = useMemo(() => getAlerts(), [dashRefresh, dashVersion, integTick, liveTick]);
    const incidents = useMemo(() => getIncidents(), [dashRefresh, dashVersion, integTick, liveTick]);

    useEffect(() => {
        if (!alerts.length) console.error("NO ALERTS LOADED");
    }, [alerts]);

    useEffect(() => {
        if (location.state?.customStart) {
            setCustomRangeStart(String(location.state.customStart));
            localStorage.setItem("soc_dashboard_custom_start", String(location.state.customStart));
        }
        if (location.state?.customEnd) {
            setCustomRangeEnd(String(location.state.customEnd));
            localStorage.setItem("soc_dashboard_custom_end", String(location.state.customEnd));
        }
    }, [location.state?.customStart, location.state?.customEnd]);

    const persistTimeRange = (key) => {
        setTimeRange(key);
        localStorage.setItem("soc_dashboard_time_range", key);
    };

    useEffect(() => {
        const onInteg = () => setIntegTick((n) => n + 1);
        window.addEventListener("soc_integrations_update", onInteg);
        return () => window.removeEventListener("soc_integrations_update", onInteg);
    }, []);

    useEffect(() => {
        const refresh = () => setDashVersion((v) => v + 1);
        window.addEventListener("soc_platform_data", refresh);
        return () => window.removeEventListener("soc_platform_data", refresh);
    }, []);

    const reloadData = useCallback(() => {
        // intentionally disabled for static unified data layer
    }, []);

    useEffect(() => {
        reloadData();
    }, [reloadData]);

    useEffect(() => {
        const onAudit = () => {
            setLastSync(new Date());
            setLiveTick((n) => n + 1);
        };
        window.addEventListener("soc_audit_update", onAudit);
        return () => window.removeEventListener("soc_audit_update", onAudit);
    }, []);

    useEffect(() => {
        const token = localStorage.getItem("isAuthToken");
        if (!token) return;

        const cleanBase = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
        const sseUrl = `${cleanBase}v1/telemetry/stream?token=${token}`;
        
        console.log("🔌 SentinelX: Connecting to live telemetry stream...", sseUrl);
        const eventSource = new EventSource(sseUrl);

        eventSource.onopen = () => {
            console.log("🔌 SentinelX: Telemetry stream connected successfully");
            setIsSseActive(true);
        };

        eventSource.onmessage = (event) => {
            try {
                const alert = JSON.parse(event.data);
                console.log("🚨 SentinelX: Live Telemetry Event Received:", alert);
                
                setIsSseActive(true);
                
                // Trigger backend data sync (debounced to avoid multiple quick requests)
                debouncedSync(500);
            } catch (err) {
                console.error("Error parsing telemetry stream message:", err);
            }
        };

        eventSource.onerror = (err) => {
            console.error("SentinelX: Telemetry stream connection error or closed:", err);
            setIsSseActive(false);
            eventSource.close();
        };

        return () => {
            console.log("🔌 SentinelX: Closing live telemetry stream");
            eventSource.close();
        };
    }, []);

    useEffect(() => {
        // Fallback poll: only run if SSE is NOT active.
        // If SSE is active, we don't need polling at all.
        // If SSE is down, we fallback to a 60-second polling interval.
        if (isSseActive) {
            console.log("🔄 SentinelX: SSE is active. Polling disabled.");
            return;
        }
        
        console.log("🔄 SentinelX: SSE inactive. Starting fallback poll (60s)...");
        const id = setInterval(() => {
            syncWithBackend();
            setLastSync(new Date());
            setLiveTick((n) => n + 1);
        }, 60000);
        
        return () => clearInterval(id);
    }, [isSseActive]);

    const dashDerived = useMemo(() => {
        try {
        const maxAlertMs = (Array.isArray(alerts) ? alerts : []).reduce((max, alert) => Math.max(max, alertTimeMs(alert)), 0);
        const syncDate = maxAlertMs > 0
            ? new Date(maxAlertMs)
            : (lastSync instanceof Date && !Number.isNaN(lastSync.getTime()) ? lastSync : new Date());
        const { startMs, endMs } = resolveRangeBounds(timeRange, syncDate, customRangeStart, customRangeEnd);

        const rawAlerts = alerts;
        const allAlerts = Array.isArray(rawAlerts) ? rawAlerts : [];
        const filteredAlerts = allAlerts;
        const alertsPrev = allAlerts;

        const incidentsAll = Array.isArray(incidents) ? incidents : [];
        const derivedIncidents = incidentsAll;
        const filteredIncidents = derivedIncidents;
        const incPrev = derivedIncidents;

        const casesAll = Array.isArray(getCases()) ? getCases() : [];
        const isOpenCase = (c) => {
            const status = String(c?.status || "").toLowerCase();
            return status !== "closed" && status !== "resolved";
        };
        const openCasesGlobal = casesAll.filter(isOpenCase).length;
        const casesInWindow = casesAll;
        const casesPrevWindow = casesAll;
        const openCasesInWindow = casesInWindow.filter(isOpenCase).length;
        const openCasesPrev = casesPrevWindow.filter(isOpenCase).length;

        const tpCount = filteredAlerts.filter((alert) => alert?.severity === "critical" || alert?.severity === "high").length;
        const fpCount = Math.max(0, filteredAlerts.length - tpCount);
        const totalDetections = tpCount + fpCount;
        const donutPct = totalDetections ? Math.min(100, Math.round((tpCount / totalDetections) * 100)) : 0;

        const totalAlertsCount = allAlerts.length;
        const totalIncidentsCount = derivedIncidents.length;
        const activeAnalysis = derivedIncidents.filter((incident) => String(incident?.status || "").toLowerCase() !== "closed").length;
        const resolvedCount = 0;
        const closedCount = derivedIncidents.filter((incident) => String(incident?.status || "").toLowerCase() === "closed").length;
        const mttrSeconds = calculateMTTR();
        const mttr = mttrSeconds > 0 ? Math.round(mttrSeconds / 60) : null;

        const sevOrder = ["critical", "high", "medium", "low"];
        const sevColors = { critical: "#fa5f38", high: "#2badee", medium: "#92b7c9", low: "#325567" };
        const counts = getSeverityCounts(filteredAlerts);
        const sevMax = Math.max(1, ...sevOrder.map((key) => counts[key]));
        const severities = sevOrder.map((label) => ({
            label: `${label.charAt(0).toUpperCase()}${label.slice(1)}`,
            count: String(counts[label]),
            color: sevColors[label],
            width: `${Math.max(4, Math.round((counts[label] / sevMax) * 100))}%`,
        }));

        const threatMap = {};
        allAlerts.forEach((a) => {
            const ip = a?.srcIP;
            if (!ip) return;
            if (!threatMap[ip]) {
                threatMap[ip] = { count: 0, severity: a?.severity };
            }
            threatMap[ip].count += 1;
            const nextSeverity = a?.severity;
            const ranks = { low: 1, medium: 2, high: 3, critical: 4 };
            if ((ranks[nextSeverity] || 0) > (ranks[threatMap[ip].severity] || 0)) {
                threatMap[ip].severity = nextSeverity;
            }
        });
        const threats = Object.entries(threatMap).map(([ip, value]) => ({
            ip,
            count: value.count,
            severity: value.severity,
            size: 8 + (value.count * 4),
            color:
                value.severity === "critical"
                    ? "#fa5f38"
                    : value.severity === "high"
                        ? "#f59e0b"
                        : value.severity === "medium"
                            ? "#2badee"
                            : "#64748b",
        }));
        const threatOrigins = threats.length
            ? threats.sort((left, right) => right.count - left.count)
            : [];

        const telemetryCounts = getTelemetry(filteredAlerts);
        const telemetry = TELEMETRY_KEYS.map(({ source, label, icon: TelemetryIcon, color }) => {
            const count = telemetryCounts.find((item) => item.name === source)?.value ?? 0;
            return {
                icon: <TelemetryIcon size={22} />,
                label,
                value: `${count}%`,
                color,
            };
        });

        const alertsInRange = filterInRange(allAlerts, alertTimeMs, startMs, endMs);
        const trend = buildTrendData(alertsInRange.length ? alertsInRange : allAlerts);

        const chAlerts = pctChange(filteredAlerts.length, alertsPrev.length);
        const chInc = pctChange(filteredIncidents.length, incPrev.length);
        const chCases = pctChange(openCasesInWindow, openCasesPrev);

        const stats = [
            { icon: <BellRing size={16} />, label: "Total Alerts", value: totalAlertsCount.toLocaleString(), change: chAlerts, changeColor: trendFromChange(chAlerts) },
            { icon: <Home size={16} />, label: "Total Incidents", value: totalIncidentsCount.toLocaleString(), change: chInc, changeColor: trendFromChange(chInc) },
            { icon: <Timer size={16} />, label: "Open Cases", value: openCasesGlobal.toLocaleString(), change: chCases, changeColor: trendFromChange(chCases) },
            { icon: <ClipboardList size={16} />, label: "Active Analysis", value: activeAnalysis.toLocaleString(), change: "—", changeColor: "gray" },
            { icon: <Clock size={16} />, label: "MTTR", value: mttr == null ? "--" : `${mttr} min`, change: "—", changeColor: "gray" },
        ];

        return {
            stats,
            severities,
            threatOrigins,
            telemetry,
            chartLabels: trend.labels,
            chartAlerts: trend.alerts,
            chartResolved: trend.resolved,
            donutPct,
            donutTp: tpCount,
            donutFp: fpCount,
            hasSeverity: filteredAlerts.length > 0,
            mttr,
            activeAnalysis,
            resolvedCount,
            closedCount,
        };
        } catch (e) {
            console.error(e);
            const telemetryFallback = TELEMETRY_KEYS.map(({ label, icon: TelemetryIcon, color }) => ({
                icon: <TelemetryIcon size={22} />,
                label,
                value: "0%",
                color,
            }));
            return {
                stats: [
                    { icon: <BellRing size={16} />, label: "Total Alerts", value: "0", change: "0%", changeColor: "gray" },
                    { icon: <Home size={16} />, label: "Total Incidents", value: "0", change: "0%", changeColor: "gray" },
                    { icon: <Timer size={16} />, label: "Open Cases", value: "0", change: "0%", changeColor: "gray" },
                    { icon: <ClipboardList size={16} />, label: "Active Analysis", value: "0", change: "—", changeColor: "gray" },
                    { icon: <Clock size={16} />, label: "MTTR", value: "--", change: "—", changeColor: "gray" },
                ],
                severities: ["critical", "high", "medium", "low"].map((label) => ({
                    label: `${label.charAt(0).toUpperCase()}${label.slice(1)}`,
                    count: "0",
                    color: { critical: "#fa5f38", high: "#2badee", medium: "#92b7c9", low: "#325567" }[label],
                    width: "4%",
                })),
                threatOrigins: [],
                telemetry: telemetryFallback,
                chartLabels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                chartAlerts: [0, 0, 0, 0, 0, 0, 0],
                chartResolved: [0, 0, 0, 0, 0, 0, 0],
                donutPct: 0,
                donutTp: 0,
                donutFp: 0,
                hasSeverity: false,
                mttr: null,
                activeAnalysis: 0,
                resolvedCount: 0,
                closedCount: 0,
            };
        }
    }, [alerts, incidents, customRangeEnd, customRangeStart, timeRange, lastSync, dashRefresh, dashVersion, integTick, liveTick]);

    if (!dashDerived) return null;

    const exportJson = () => {
        const allCases = getCases();
        const allIncidents = getIncidents();
        const auditLog = [];

        // Calculate analyst workload from cases
        const analystWorkload = {};
        allCases.forEach((c) => {
            const analyst = c.assignedTo || c.owner || "Unassigned";
            analystWorkload[analyst] = (analystWorkload[analyst] || 0) + 1;
        });

        // Calculate open cases
        const openCases = allCases.filter((c) => c.status !== "closed" && !c.archived);
        const closedCases = allCases.filter((c) => c.status === "closed");
        const truePositiveCases = closedCases.filter((c) => c.resolution === "true_positive" || c.classification === "true_positive");
        const falsePositiveCases = closedCases.filter((c) => c.resolution === "false_positive" || c.classification === "false_positive");

        // Calculate detection accuracy
        const detectionAccuracy = closedCases.length > 0
            ? Math.round((truePositiveCases.length / closedCases.length) * 100)
            : 0;

        const payload = {
            reportTitle: "Incident Response Performance Report",
            timeRange,
            refreshSeq: dashRefresh,
            liveTick,
            lastSync: lastSync.toISOString(),
            customStart: customRangeStart,
            customEnd: customRangeEnd,
            stats: dashDerived.stats,
            chart: { labels: dashDerived.chartLabels, alerts: dashDerived.chartAlerts, resolutions: dashDerived.chartResolved },
            severities: dashDerived.severities,
            threatOrigins: dashDerived.threatOrigins,
            telemetry: dashDerived.telemetry,
            snapshot: {
                totalAlerts: (Array.isArray(alerts) ? alerts : []).length,
                totalIncidents: (Array.isArray(allIncidents) ? allIncidents : []).length,
                openCases: openCases.length,
                closedCases: closedCases.length,
                totalCases: allCases.length,
                mttr: dashDerived.mttr,
                activeAnalysis: dashDerived.activeAnalysis,
                detectionAccuracy: `${detectionAccuracy}%`,
                truePositiveCases: truePositiveCases.length,
                falsePositiveCases: falsePositiveCases.length,
            },
            auditMetrics: {
                analystWorkload,
                totalAnalysts: Object.keys(analystWorkload).length,
                averageCasesPerAnalyst: allCases.length > 0 ? Math.round(allCases.length / Object.keys(analystWorkload).length) : 0,
            },
            exportedAt: new Date().toISOString(),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `soc-report-${timeRange}-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const onManualRefresh = () => {
        if (refreshBusy) return;
        setRefreshBusy(true);
        setDashRefresh((n) => n + 1);
        setLastSync(new Date());
        try {
            reloadData();
        } finally {
            setRefreshBusy(false);
        }
    };

    let main;
    try {
        main = (
        <div className="dash-page">

            <header className="dash-topbar soc-topbar">
                <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                    <SocLogo />
                {(() => {
                    const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
                    const roleType = (user.roleType || "analyst").toLowerCase();
                    return (
                        <nav className="dash-topnav">
                            <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>Dashboard</NavLink>
                            {(roleType === "admin" || roleType === "analyst") && <NavLink to="/alerts">Alerts</NavLink>}
                            <NavLink to="/incidents">Incidents</NavLink>
                            {(roleType === "admin" || roleType === "analyst") && <NavLink to="/intelligence">Intelligence</NavLink>}
                            {(roleType === "admin" || roleType === "analyst") && <NavLink to="/cases">Cases</NavLink>}
                            {roleType === "admin" && <NavLink to="/audit">Audit & Metrics</NavLink>}
                            {roleType === "admin" && <NavLink to="/settings">Settings</NavLink>}
                        </nav>
                    );
                })()}
                </div>

                <div className="dash-topbar-right soc-topbar-actions">
                    {(() => {
                        try {
                            const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
                            const roleType = (user.roleType || "analyst").toLowerCase();
                            const roleLabels = {
                                "admin": "Administrator",
                                "analyst": "SOC Analyst",
                                "viewer": "Viewer"
                            };
                            const role = roleLabels[roleType] || "User";
                            const roleColors = {
                                "admin": "#fa5f38",
                                "analyst": "#2badee",
                                "viewer": "#64748b"
                            };
                            return (
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "6px 12px",
                                    backgroundColor: "rgba(255,255,255,0.05)",
                                    borderRadius: 6,
                                    border: `1px solid ${roleColors[roleType] || "#92b7c9"}33`,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: roleColors[roleType] || "#92b7c9"
                                }}>
                                    <span style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        backgroundColor: roleColors[roleType] || "#92b7c9"
                                    }} />
                                    {role}
                                </div>
                            );
                        } catch {
                            return null;
                        }
                    })()}
                    <button
                        type="button"
                        className="dash-btn-primary"
                        onClick={onManualRefresh}
                        disabled={refreshBusy}
                        style={refreshBusy ? { opacity: 0.65 } : undefined}
                    >
                        <RefreshCw size={14} className={refreshBusy ? "dash-refresh-spin" : undefined} />
                        Refresh
                    </button>
                    <button type="button" className="dash-btn-dark" onClick={exportJson}>
                        <Download size={14} />
                        Export
                    </button>
                    <HeaderNotificationBell className="dash-btn-dark">
                        <Bell size={16} />
                    </HeaderNotificationBell>
                    <HeaderSettingsNav className="dash-btn-dark">
                        <Settings size={16} />
                    </HeaderSettingsNav>
                    <HeaderMenuAvatar
                        className="dash-avatar"
                        onLogout={() => { logoutSession(); navigate("/"); }}
                    />
                </div>
            </header>

            <main className="dash-main">
                <div className="dash-heading">
                    <div>
                        <h1>Executive SOC Overview</h1>
                        <p>Real-time security operations statistics and threat intelligence overview.</p>
                    </div>
                    <div className="dash-filters-wrap">
                        <div className="dash-filters soc-filter-row">
                            <button type="button" className={`dash-filter-btn soc-filter-btn ${timeRange === "24h" ? "active" : ""}`} onClick={() => persistTimeRange("24h")}>Last 24h</button>
                            <button type="button" className={`dash-filter-btn soc-filter-btn ${timeRange === "7d" ? "active" : ""}`} onClick={() => persistTimeRange("7d")}>Last 7d</button>
                            <button type="button" className={`dash-filter-btn soc-filter-btn ${timeRange === "custom" ? "active" : ""}`} onClick={() => persistTimeRange("custom")}>Custom</button>
                        </div>
                        {timeRange === "custom" ? (
                            <div className="dash-custom-range soc-filter-row" style={{ marginTop: 8 }}>
                                <input
                                    type="datetime-local"
                                    className="soc-date-input"
                                    value={customRangeStart}
                                    onChange={(e) => {
                                        setCustomRangeStart(e.target.value);
                                        localStorage.setItem("soc_dashboard_custom_start", e.target.value);
                                    }}
                                    aria-label="Range start"
                                />
                                <input
                                    type="datetime-local"
                                    className="soc-date-input"
                                    value={customRangeEnd}
                                    onChange={(e) => {
                                        setCustomRangeEnd(e.target.value);
                                        localStorage.setItem("soc_dashboard_custom_end", e.target.value);
                                    }}
                                    aria-label="Range end"
                                />
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="dash-stats-grid">
                    {dashDerived.stats.map((stat, index) => (
                        <div key={index} className="dash-stat-card">
                            <p className="dash-stat-label">{stat.icon}{stat.label}</p>
                            <div className="dash-stat-row">
                                <p className="dash-stat-value">{stat.value}</p>
                                <span className={`dash-stat-change change-${stat.changeColor}`}>{stat.change}</span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="dash-grid">
                    <div className="dash-card dash-card-wide">
                        <div className="dash-card-header">
                            <h3>Attack Trends vs. Resolution</h3>
                            <div className="dash-legend">
                                <span><span className="dash-dot blue" />Alerts Created</span>
                                <span><span className="dash-dot green" />Incidents Closed</span>
                            </div>
                        </div>
                        <div className="dash-chart-wrap">
                            <AttackTrendsChartFixed
                                labels={dashDerived.chartLabels}
                                alertsData={dashDerived.chartAlerts}
                                resolvedData={dashDerived.chartResolved}
                                refreshKey={dashRefresh + integTick + liveTick}
                            />
                        </div>
                    </div>

                    <div className="dash-card dash-card-narrow">
                        <h3 className="dash-card-title">Detection Accuracy (TP vs FP)</h3>
                        <div className="dash-donut-wrap">
                            <div className="dash-donut">
                                <div className="dash-donut-inner">
                                    <p className="dash-donut-pct">{dashDerived.donutPct}%</p>
                                    <p className="dash-donut-label">True Positive</p>
                                </div>
                            </div>
                        </div>
                        <div className="dash-donut-stats">
                            <div>
                                <div className="dash-legend-item">
                                    <span className="dash-dot blue" /><span>True Positives</span>
                                </div>
                                <p className="dash-donut-stat-val">{dashDerived.donutTp}</p>
                            </div>
                            <div>
                                <div className="dash-legend-item">
                                    <span className="dash-dot orange" /><span>False Positives</span>
                                </div>
                                <p className="dash-donut-stat-val">{dashDerived.donutFp}</p>
                            </div>
                        </div>
                    </div>

                    <div className="dash-card dash-card-sm">
                        <h3 className="dash-card-title">Alerts by Severity</h3>
                        <div className="dash-severity-list">
                            {!dashDerived.hasSeverity ? (
                                <div className="dash-chart-empty" style={{ minHeight: 120 }}>No data available</div>
                            ) : (
                                dashDerived.severities.map((severity, index) => (
                                    <div key={index} className="dash-severity-item">
                                        <div className="dash-severity-row">
                                            <span>{severity.label}</span>
                                            <span>{severity.count}</span>
                                        </div>
                                        <div className="dash-severity-bar-bg">
                                            <div className="dash-severity-bar-fill" style={{ width: severity.width, background: severity.color }} />
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="dash-card dash-card-lg">
                        <div className="dash-card-header">
                            <h3 className="dash-card-title">Top Threat Origins</h3>
                            <button type="button" className="dash-link-btn">Full Map View</button>
                        </div>
                        <div className="dash-map-area">
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                                {dashDerived.threatOrigins.length === 0 ? (
                                    <div className="dash-chart-empty">No data available</div>
                                ) : dashDerived.threatOrigins.map((threat, idx) => (
                                    <div
                                        key={`threat-${threat.ip}-${idx}`}
                                        title={`${threat.ip} • ${threat.count} alerts`}
                                        style={{
                                            width: threat.size,
                                            height: threat.size,
                                            borderRadius: "999px",
                                            background: `${threat.color}55`,
                                            border: `2px solid ${threat.color}`,
                                        }}
                                    />
                                ))}
                            </div>
                            <div className="dash-map-legend">
                                {dashDerived.threatOrigins.map((threat, idx) => (
                                    <div key={`legend-${threat.ip}-${idx}`} className="dash-map-legend-item">
                                        <span>{threat.ip} ({threat.count} alerts)</span>
                                        <div className="dash-bar" style={{ background: threat.color, width: `${Math.min(100, threat.size)}px` }} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="dash-card dash-card-full">
                        <h3 className="dash-card-title">Telemetry Source Distribution</h3>
                        <div className="dash-telemetry-row">
                            {dashDerived.telemetry.map((item, index) => (
                                <div key={index} className="dash-telemetry-item">
                                    <div className="dash-telemetry-ring" style={{ borderColor: item.color }}>
                                        <span style={{ color: item.color }}>{item.icon}</span>
                                    </div>
                                    <p className="dash-telemetry-label">{item.label}</p>
                                    <p className="dash-telemetry-val">{item.value}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>

            <footer className="dash-footer">
                <p>© 2026 Sentinel X Executive Dashboard · Confidential</p>
                <div className="dash-footer-right">
                    <div className="dash-footer-status">
                        <span className="dash-status-dot" />
                        <span>Systems Operational </span>
                    </div>
                    <span>Last Updated: {formatTime(lastSync || Date.now())}</span>
                </div>
            </footer>
        </div>
        );
    } catch (e) {
        console.error(e);
        main = <div className="dash-page"><main className="dash-main"><p className="dash-chart-empty">No data available</p></main></div>;
    }
    return main;
}
