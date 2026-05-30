import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { enrichIP } from "../services/threatIntelService";
import { mergeIntelApi, mockIntelEnvelope } from "../mocks/intelligenceMock";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import {
    Search, Bell, Settings, LayoutDashboard, Shield,
    Bug, Info, RefreshCw, Share, TrendingUp,
    Globe, FileText, Loader
} from "lucide-react";
import "../styles/Intelligence.css";
import { logoutSession } from "../session";
import { formatTime } from "../utils/formatTime";

const navItems = [
    { id: "overview", icon: <LayoutDashboard size={18} />, label: "Overview" },
    { id: "vt", icon: <Shield size={18} />, label: "VirusTotal" },
    { id: "abuse", icon: <Bug size={18} />, label: "AbuseIPDB" },
    { id: "whois", icon: <Info size={18} />, label: "Whois Data" },
];

export default function Intelligence() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const indicator = (searchParams.get("ip") || searchParams.get("indicator") || "").trim() || "193.161.193.99";

    const [reputation, setReputation] = useState("Malicious");
    const [searchVal, setSearchVal] = useState(indicator);
    const [activeSection, setActiveSection] = useState("overview");
    const [rescanBusy, setRescanBusy] = useState(false);
    const [intelLoading, setIntelLoading] = useState(false);
    const [intelError, setIntelError] = useState(null);
    const [remoteIntel, setRemoteIntel] = useState(null);
    const [lastCheckedAt, setLastCheckedAt] = useState(() => Date.now());
    const [apiIntel, setApiIntel] = useState(null);
    const [rescanCount, setRescanCount] = useState(0);

    useEffect(() => {
        setSearchVal(indicator);
    }, [indicator]);

    // Fetch from real APIs
    useEffect(() => {
        const fetchIntel = async () => {
            setIntelLoading(true);
            setIntelError(null);
            try {
                const result = await enrichIP(indicator);
                setApiIntel(result);
                setIntelError(null);
            } catch (error) {
                console.error("Failed to fetch threat intel:", error);
                setIntelError("Failed to fetch threat intelligence. Using fallback data.");
                setApiIntel(null);
            } finally {
                setIntelLoading(false);
                setRescanBusy(false);
                setLastCheckedAt(Date.now());
            }
        };

        fetchIntel();
    }, [indicator]);

    const runSearch = () => {
        const v = (searchVal || "").trim() || "193.161.193.99";
        setSearchParams({ ip: v });
    };

    const handleRescan = async () => {
        if (rescanBusy || intelLoading) return;
        setRescanBusy(true);
        setIntelLoading(true);
        setRescanCount((n) => n + 1);
        try {
            const result = await enrichIP(indicator, true);
            setApiIntel(result);
            setIntelError(null);
        } catch (error) {
            console.error("Rescan failed:", error);
            setIntelError("Rescan failed. Please try again.");
        } finally {
            setIntelLoading(false);
            setRescanBusy(false);
            setLastCheckedAt(Date.now());
        }
    };

    // Merge API data with mock fallback
    const merged = useMemo(() => {
        if (apiIntel && !apiIntel.error) {
            // Use real API data
            return {
                virustotal: {
                    detections: apiIntel.vt?.malicious || 0,
                    total: apiIntel.vt?.totalVendors || 72,
                    tags: [],
                    sandbox: "",
                },
                abuseipdb: {
                    reports: apiIntel.abuse?.totalReports || 0,
                    confidence: (apiIntel.abuse?.abuseConfidenceScore || 0) + "%",
                    last_reported: apiIntel.abuse?.lastReportedAt || "Never",
                    usage_type: apiIntel.abuse?.usageType || "Unknown",
                    isp: apiIntel.abuse?.isp || "Unknown",
                    country: apiIntel.abuse?.country || "Unknown",
                    city: apiIntel.abuse?.city || "Unknown",
                    hostname: apiIntel.abuse?.hostname || "Unknown",
                    domain: apiIntel.abuse?.domain || null,
                },
                whois: {
                    geo: {
                        city: apiIntel.abuse?.city || "Unknown",
                        label: `${apiIntel.abuse?.city || "Unknown"}, ${apiIntel.abuse?.country || "Unknown"}`,
                        asn: apiIntel.vt?.asn || "Unknown",
                        isPrivate: apiIntel.isPrivate || false,
                    },
                    rows: [],
                },
                internal_logs: apiIntel.logs || [],
                risk: apiIntel.threatScore || 0,
            };
        }

        // Fallback to mock data
        const local = mockIntelEnvelope(indicator, 0);
        return mergeIntelApi(local, indicator, 0);
    }, [apiIntel, indicator]);

    const enriched = useMemo(() => {
        const vt = merged.virustotal || {};
        const ab = merged.abuseipdb || {};
        const g = (merged.whois && merged.whois.geo) || {};
        const rows = (merged.whois && merged.whois.rows) || [];
        const tags = Array.isArray(vt.tags) ? vt.tags : [];
        const risk = merged.risk ?? 62;

        // Determine reputation based on detections
        let reputationStatus = "Good";
        if (vt.detections > 10) {
            reputationStatus = "Malicious";
        } else if (vt.detections > 5) {
            reputationStatus = "Suspicious";
        }

        // Generate dynamic threat description
        const threatDescriptions = [
            "Possible C2 infrastructure",
            "Suspicious scanning activity",
            "Known TOR relay node",
            "Clean infrastructure behavior",
            "Malware communication pattern detected",
            "Potential botnet node",
            "Suspicious DNS activity",
            "Known phishing infrastructure",
        ];
        let threatDesc = threatDescriptions[Math.floor(Math.random() * threatDescriptions.length)];
        if (risk < 35) {
            threatDesc = "Clean infrastructure behavior";
        } else if (risk < 70) {
            threatDesc = "Suspicious scanning activity";
        } else {
            threatDesc = "Possible C2 infrastructure";
        }

        // Build WHOIS rows dynamically from AbuseIPDB data
        let whoisRows = [];
        if (g.isPrivate) {
            whoisRows = [
                { property: "Address Space", value: "RFC1918 Private", source: "IANA", mono: true },
                { property: "Type", value: "Internal Infrastructure", source: "Local", mono: false },
                { property: "Organization", value: "Internal Network", source: "Local", mono: false },
            ];
        } else {
            whoisRows = [
                { property: "ISP", value: ab.isp || "Unknown", source: "AbuseIPDB", mono: false },
                { property: "Hostname", value: ab.hostname || "Unknown", source: "AbuseIPDB", mono: true },
                { property: "Domain", value: ab.domain || "Unknown", source: "AbuseIPDB", mono: true },
                { property: "Country", value: ab.country || "Unknown", source: "AbuseIPDB", mono: false },
                { property: "City", value: ab.city || "Unknown", source: "AbuseIPDB", mono: false },
                { property: "Usage Type", value: ab.usage_type || "Unknown", source: "AbuseIPDB", mono: false },
            ];
        }

        return {
            vt: vt.detections || 0,
            vtSuspicious: vt.suspicious || 0,
            vtHarmless: vt.harmless || 0,
            vtTotal: vt.total || 72,
            vtTags: tags,
            sandbox: vt.sandbox || "",
            risk,
            threatDesc,
            reputationStatus,
            abuse: typeof ab.reports === "number" ? ab.reports : 0,
            abuseConf: ab.confidence ? parseInt(ab.confidence) : 0,
            abuseLast: ab.last_reported || "Never",
            abuseUsage: ab.usage_type || "Unknown",
            abuseIsp: ab.isp || "Unknown",
            geoCity: ab.city || "Unknown Location",
            geoLbl: `${ab.city || "Unknown"}, ${ab.country || "Unknown"}`,
            asn: g.asn || "Unknown",
            whoisRows,
            isPrivate: g.isPrivate || false,
        };
    }, [merged]);

    const exportJson = () => {
        const payload = {
            ip: indicator,
            indicator,
            reputation,
            timestamp: new Date().toISOString(),
            whoisRows: enriched.whoisRows,
            seq: rescanCount,
            enrichment: merged,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `intel-${indicator.replace(/[^a-z0-9.-]/gi, "_")}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div className="intel-page">

            {/* TOPBAR */}
            <header className="intel-topbar">
                <div className="intel-topbar-left">
                    <div className="intel-logo">
                        <SocLogo />
                    </div>
                    {(() => {
                        const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
                        const roleType = (user.roleType || "analyst").toLowerCase();
                        return (
                            <nav className="intel-topnav">
                                <NavLink to="/dashboard">Dashboard</NavLink>
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/alerts">Alerts</NavLink>}
                                <NavLink to="/incidents">Incidents</NavLink>
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/intelligence" className="active">Intelligence</NavLink>}
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/cases">Cases</NavLink>}
                                {roleType === "admin" && <NavLink to="/audit">Audit & Metrics</NavLink>}
                                {roleType === "admin" && <NavLink to="/settings">Settings</NavLink>}
                            </nav>
                        );
                    })()}
                </div>
                <div className="intel-topbar-right">
                    <div className="intel-search">
                        <Search size={16} />
                        <input
                            value={searchVal}
                            onChange={e => setSearchVal(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") runSearch();
                            }}
                            placeholder="Search IP, Domain, or Hash..."
                        />
                    </div>
                    <div className="intel-icon-btns">
                        <HeaderNotificationBell className="intel-icon-btn">
                            <Bell size={18} />
                        </HeaderNotificationBell>
                        <HeaderSettingsNav className="intel-icon-btn">
                            <Settings size={18} />
                        </HeaderSettingsNav>
                    </div>
                    <HeaderMenuAvatar
                        className="intel-avatar"
                        onLogout={() => { logoutSession(); navigate("/"); }}
                    />
                </div>
            </header>

            <div className="intel-body">

                {/* SIDEBAR */}
                <aside className="intel-sidebar">
                    <div className="intel-sidebar-top">
                        <div className="intel-sidebar-brand">
                            <h1>Threat Intel</h1>
                            <p className="intel-version">ENRICHMENT v2.4.0</p>
                        </div>
                        <nav className="intel-sidebar-nav">
                            {navItems.map((item) => (
                                <button
                                    type="button"
                                    key={item.id}
                                    className={`intel-nav-item ${activeSection === item.id ? "active" : ""}`}
                                    onClick={() => setActiveSection(item.id)}
                                >
                                    {item.icon}<span>{item.label}</span>
                                </button>
                            ))}
                        </nav>
                    </div>
                    <div className="intel-notice">
                        <p className="intel-notice-title">Investigation Notice</p>
                        <p className="intel-notice-text">Data for context only. Does not confirm active attack. Correlation required.</p>
                    </div>
                </aside>

                {/* MAIN */}
                <main className="intel-main">
                    <div className="intel-container">

                        {/* PAGE HEADING */}
                        <div className="intel-page-heading">
                            <div>
                                <div className="intel-ip-row">
                                    <h1 className="intel-ip">{indicator}</h1>
                                    <button
                                        type="button"
                                        className="intel-copy-btn"
                                        title="Copy"
                                        onClick={() => navigator.clipboard?.writeText(indicator)}
                                    >
                                        ⎘
                                    </button>
                                </div>
                                <p className="intel-ip-sub">Indicator Type: IPv4 Address • Last Checked: {formatTime(lastCheckedAt)}{intelLoading ? " • Loading…" : ""}{intelError && !intelLoading ? ` • ${intelError}` : ""} (seq {rescanCount})</p>
                            </div>
                            <div className="intel-heading-actions">
                                <button type="button" className="intel-rescan-btn" onClick={handleRescan} disabled={rescanBusy || intelLoading} aria-busy={rescanBusy || intelLoading}>
                                    {(rescanBusy || intelLoading) ? (
                                        <>
                                            <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
                                            Scanning…
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw size={14} />
                                            Re-scan
                                        </>
                                    )}
                                </button>
                                <button type="button" className="intel-export-btn" onClick={exportJson}><Share size={14} />Export Report</button>
                            </div>
                        </div>

                        {/* STATUS & RISK */}
                        <div className="intel-risk-grid" style={{ display: activeSection === "overview" ? undefined : "none" }}>

                            {/* REPUTATION */}
                            <div className="intel-card">
                                <h3 className="intel-card-title">Aggregated Reputation</h3>
                                <div className="intel-rep-toggle">
                                    {["Malicious", "Suspicious", "Good"].map(r => (
                                        <label key={r} className={`intel-rep-option ${enriched.reputationStatus === r ? `selected-${r.toLowerCase()}` : ""}`}>
                                            <span>{r}</span>
                                            <input type="radio" name="reputation" value={r} checked={enriched.reputationStatus === r} onChange={() => setReputation(r)} disabled />
                                        </label>
                                    ))}
                                </div>
                                <p className="intel-rep-note">Based on VirusTotal detections ({enriched.vt} malicious, {enriched.vtSuspicious} suspicious) and AbuseIPDB confidence ({enriched.abuseConf}%).</p>
                            </div>

                            {/* RISK SCORE */}
                            <div className="intel-card intel-risk-card">
                                <div className="intel-gauge">
                                    <div className="intel-gauge-ring" />
                                    <div className="intel-gauge-score">
                                        <span className="intel-gauge-num">{enriched.risk}</span>
                                        <span className="intel-gauge-label">Risk Score</span>
                                    </div>
                                </div>
                                <div className="intel-risk-info">
                                    <h3>{enriched.risk >= 80 ? "Critical Risk" : enriched.risk >= 60 ? "High Risk" : enriched.risk >= 40 ? "Medium Risk" : "Low Risk"} Detected</h3>
                                    <p>This indicator {enriched.threatDesc.toLowerCase()}. Detection confidence from {enriched.vt}/{enriched.vtTotal} AV engines.</p>
                                    <div className="intel-risk-stats">
                                        <div>
                                            <span className="intel-stat-label">Detections</span>
                                            <span className="intel-stat-val">{enriched.vt}/{enriched.vtTotal}</span>
                                        </div>
                                        <div>
                                            <span className="intel-stat-label">Abuse Conf.</span>
                                            <span className="intel-stat-val">{enriched.abuseConf}%</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* DATA SOURCES */}
                        <div className="intel-sources-grid">

                            {/* VIRUSTOTAL */}
                            <div className="intel-card intel-card-overflow" style={{ display: (activeSection === "overview" || activeSection === "vt") ? undefined : "none" }}>
                                <div className="intel-source-header">
                                    <div className="intel-source-title">
                                        <Shield size={16} color="#2badee" />
                                        <span>VirusTotal Enrichment</span>
                                    </div>
                                    <span className={`intel-badge ${enriched.vt > 10 ? "critical" : enriched.vt > 5 ? "warning" : "info"}`}>
                                        {enriched.vt > 10 ? "Critical" : enriched.vt > 5 ? "Warning" : "Clean"}
                                    </span>
                                </div>
                                <div className="intel-source-body">
                                    <div className="intel-vt-score-row">
                                        <div>
                                            <p className="intel-vt-score">{enriched.vt} <span>/{enriched.vtTotal}</span></p>
                                            <p className="intel-vt-label">Security vendor detections</p>
                                        </div>
                                    </div>
                                    <div className="intel-tags">
                                        {enriched.vtTags && enriched.vtTags.length > 0 ? (
                                            enriched.vtTags.map((tag) => (
                                                <span key={tag}>{tag}</span>
                                            ))
                                        ) : (
                                            <span style={{ color: "#92b7c9" }}>No tags available</span>
                                        )}
                                    </div>
                                    <div className="intel-sandbox-box">
                                        <p className="intel-sandbox-title">Detection Summary:</p>
                                        <p>{enriched.sandbox || `${enriched.vt} malicious, ${enriched.vtSuspicious} suspicious, ${enriched.vtHarmless} harmless detections`}</p>
                                    </div>
                                </div>
                            </div>

                            {/* ABUSEIPDB */}
                            <div className="intel-card intel-card-overflow" style={{ display: (activeSection === "overview" || activeSection === "abuse") ? undefined : "none" }}>
                                <div className="intel-source-header">
                                    <div className="intel-source-title">
                                        <Bug size={16} color="#2badee" />
                                        <span>AbuseIPDB Insights</span>
                                    </div>
                                    <span className={`intel-badge ${enriched.abuseConf > 75 ? "critical" : enriched.abuseConf > 50 ? "warning" : "info"}`}>
                                        {enriched.abuseConf > 75 ? "High Confidence" : enriched.abuseConf > 50 ? "Medium Confidence" : "Low Confidence"}
                                    </span>
                                </div>
                                <div className="intel-source-body">
                                    <div className="intel-abuse-stats">
                                        <div className="intel-abuse-stat">
                                            <p className="intel-abuse-label">Confidence</p>
                                            <p className="intel-abuse-val">{enriched.abuseConf}%</p>
                                        </div>
                                        <div className="intel-abuse-stat">
                                            <p className="intel-abuse-label">Total Reports</p>
                                            <p className="intel-abuse-val">{enriched.abuse.toLocaleString()}</p>
                                        </div>
                                    </div>
                                    <div className="intel-abuse-rows">
                                        <div className="intel-abuse-row"><span>Last Reported</span><span>{enriched.abuseLast}</span></div>
                                        <div className="intel-abuse-row"><span>Usage Type</span><span>{enriched.abuseUsage}</span></div>
                                        <div className="intel-abuse-row no-border"><span>ISP</span><span>{enriched.abuseIsp}</span></div>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* GEO + WHOIS */}
                        <div className="intel-geo-grid" style={{ display: (activeSection === "overview" || activeSection === "whois") ? undefined : "none" }}>

                            {/* GEOLOCATION */}
                            <div className="intel-card intel-card-overflow">
                                <div className="intel-geo-header">
                                    <Globe size={16} color="#92b7c9" />
                                    <span className="intel-section-label">Geolocation</span>
                                </div>
                                {enriched.isPrivate ? (
                                    <div style={{ padding: "20px", textAlign: "center", color: "#92b7c9" }}>
                                        <p style={{ fontSize: "14px", margin: "10px 0" }}>Internal Asset</p>
                                        <p style={{ fontSize: "12px", color: "#5a7a8a" }}>RFC1918 Private Address Space</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="intel-map-area">
                                            <div className="intel-map-bg" />
                                            <div className="intel-map-dot" />
                                            <div className="intel-map-label">{enriched.geoLbl}</div>
                                        </div>
                                        <div className="intel-geo-details">
                                            <div className="intel-geo-row"><span>City:</span><span>{enriched.geoCity}</span></div>
                                            <div className="intel-geo-row"><span>ASN:</span><span>{enriched.asn}</span></div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* WHOIS */}
                            <div className="intel-card intel-card-overflow intel-whois-card">
                                <div className="intel-geo-header">
                                    <FileText size={16} color="#92b7c9" />
                                    <span className="intel-section-label">Whois / DNS Metadata</span>
                                </div>
                                <div className="intel-table-wrap">
                                    <table className="intel-table">
                                        <thead>
                                            <tr>
                                                <th>Property</th>
                                                <th>Value</th>
                                                <th>Source</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {enriched.whoisRows.map((row, i) => (
                                                <tr key={`whois-${i}-${row.property}`}>
                                                    <td className="intel-td-muted">{row.property}</td>
                                                    <td className={row.mono ? "intel-td-mono" : ""}>
                                                        {row.domains ? (
                                                            <div className="intel-domains">
                                                                <span className="intel-domain-danger">{row.domains[0]}</span>
                                                                <span>{row.domains[1]}</span>
                                                            </div>
                                                        ) : row.value}
                                                    </td>
                                                    <td className="intel-td-source">{row.source}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                        </div>

                    </div>
                </main>
            </div>
        </div>
    );
}
