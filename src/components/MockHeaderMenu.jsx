import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Settings } from "lucide-react";
import { getCurrentUser, readSocUsers, roleLabelFromType, userDisplayName } from "../session";
import { readSocProfile } from "../socProfile";
import { getAlerts, getCases, getNotifications, setNotifications, syncWithBackend } from "../platformStore";
import { markAllNotificationsRead, markNotificationRead } from "../api/socService";
import { formatTime } from "../utils/formatTime";
import "../styles/socHeaderOverlays.css";

function initialsFromUser(name, email) {
    const n = (name || "").trim();
    if (n) {
        const parts = n.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return n.slice(0, 2).toUpperCase();
    }
    const e = (email || "").trim();
    return e.length >= 2 ? e.slice(0, 2).toUpperCase() : "??";
}

function formatLastLoginDisplay(raw) {
    if (raw == null || raw === "") return "—";
    if (typeof raw === "string" && /mins ago|hour|day|week|month/i.test(raw)) return raw;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return formatTime(ms);
    return String(raw);
}

function formatRelativeLastActive(raw) {
    if (raw == null || raw === "") return "Last active: —";
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) return `Last active: ${formatLastLoginDisplay(raw)}`;
    const diff = Date.now() - ms;
    if (diff < 0) return `Last active: ${formatTime(ms)}`;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Last active: just now";
    if (mins < 60) return `Last active: ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Last active: ${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `Last active: ${days}d ago`;
    return `Last active: ${formatTime(ms)}`;
}

function resolveProfileAvatar(avatarRaw) {
    const a = String(avatarRaw || "").trim();
    if (!a) return null;
    if (a.startsWith("data:") || /^https?:\/\//i.test(a)) return a;
    return `data:image/png;base64,${a}`;
}

export function sessionUserPanel() {
    const prof = readSocProfile();
    const u = getCurrentUser();
    const baseName = userDisplayName(u);
    const name = (prof.name && prof.name.trim()) ? prof.name.trim() : baseName;
    const rt = (u?.roleType || localStorage.getItem("currentRole") || "analyst").toLowerCase();
    const role = (prof.role && prof.role.trim()) ? prof.role.trim() : roleLabelFromType(rt);
    const email = (prof.email && prof.email.trim())
        ? prof.email.trim()
        : (u?.email || "").trim() || `${name}@cybersec.io`;
    const users = readSocUsers() || [];
    const full = users.find((x) => x.id === u?.id || (x.email || "").toLowerCase() === (u?.email || "").toLowerCase());
    const rawLogin = full?.lastLogin ?? u?.lastLogin;
    const profAvatar = resolveProfileAvatar(prof.avatar);
    const avatarUrl = profAvatar || u?.avatarUrl || full?.avatarUrl || null;
    return {
        name,
        email,
        role,
        roleType: rt,
        lastLogin: formatLastLoginDisplay(rawLogin),
        initials: full?.initials || initialsFromUser(name, email),
        avatarUrl,
    };
}

const panelStyle = {
    position: "absolute",
    right: 0,
    top: "100%",
    marginTop: 6,
    minWidth: 176,
    background: "#111c22",
    border: "1px solid #233c48",
    borderRadius: 8,
    padding: "4px 0",
    zIndex: 300,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
};

const itemStyle = {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    color: "#92b7c9",
    padding: "10px 14px",
    cursor: "pointer",
    fontSize: 13,
};

const GROUP_ORDER = ["incident", "case", "response", "general"];
const GROUP_TITLES = {
    incident: "Incident Created",
    case: "Case Escalated",
    response: "Response Action",
    general: "",
};

function groupKey(item) {
    const c = item?.category || "general";
    if (GROUP_ORDER.includes(c)) return c;
    return "general";
}

function normalizeNotification(item) {
    return {
        ...item,
        text: item.title || item.body || "SOC notification",
        read: !!item.is_read,
        unread: !item.is_read,
        at: item.created_at ? Date.parse(item.created_at) : Date.now(),
        category: item.type || "general",
    };
}

export function HeaderNotificationBell({ className, badgeClassName, children }) {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState([]);
    const ref = useRef(null);
    const isUnread = (item) => item?.read !== true && item?.unread !== false;
    const unread = items.filter(isUnread).length;

    const grouped = useMemo(() => {
        const m = new Map();
        for (const k of GROUP_ORDER) m.set(k, []);
        for (const it of items) {
            const g = groupKey(it);
            if (!m.has(g)) m.set(g, []);
            m.get(g).push(it);
        }
        return GROUP_ORDER.map((k) => ({ key: k, title: GROUP_TITLES[k], list: m.get(k) || [] })).filter((x) => x.list.length);
    }, [items]);

    const loadFromStore = () => {
        const rows = getNotifications();
        setItems((Array.isArray(rows) ? rows : []).map(normalizeNotification));
    };

    useEffect(() => {
        const fn = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", fn);
        return () => document.removeEventListener("mousedown", fn);
    }, []);

    useEffect(() => {
        const esc = (e) => {
            if (e.key === "Escape") setOpen(false);
        };
        if (open) document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [open]);

    useEffect(() => {
        loadFromStore();
        const onStore = () => loadFromStore();
        window.addEventListener("soc_notifications_update", onStore);
        return () => {
            window.removeEventListener("soc_notifications_update", onStore);
        };
    }, []);

    const markAsRead = async (id) => {
        const currentNotifs = getNotifications();
        const updated = currentNotifs.map(item => 
            String(item.id) === String(id) ? { ...item, read: true, unread: false, is_read: true } : item
        );
        setNotifications(updated);
        try {
            await markNotificationRead(id);
        } catch (error) {
            console.error("Failed to mark notification as read:", error);
            await syncWithBackend();
        }
    };

    const markAllRead = async () => {
        const currentNotifs = getNotifications();
        const updated = currentNotifs.map(item => ({ ...item, read: true, unread: false, is_read: true }));
        setNotifications(updated);
        try {
            await markAllNotificationsRead();
        } catch (error) {
            console.error("Failed to mark notifications as read:", error);
            await syncWithBackend();
        }
    };

    return (
        <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
            <button type="button" className={className} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {children}
            </button>
            {unread > 0 ? (
                <span className={badgeClassName || "soc-notif-badge-default"} aria-label={`${unread} unread`}>
                    {unread > 99 ? "99+" : unread}
                </span>
            ) : null}
            {open && (
                <div role="menu" style={{ ...panelStyle, minWidth: 280, maxWidth: 360 }}>
                    <div className="soc-notif-scroll" style={{ maxHeight: 400, overflowY: "auto", scrollBehavior: "smooth" }}>
                        {items.length === 0 ? (
                            <div style={{ ...itemStyle, cursor: "default" }}>No data available</div>
                        ) : (
                            grouped.map((g) => (
                                <div key={g.key}>
                                    {g.title ? <div className="soc-notif-group-label">{g.title}</div> : null}
                                    {g.list.map((it) => (
                                        <button
                                            key={it.id}
                                            type="button"
                                            style={{
                                                ...itemStyle,
                                                opacity: isUnread(it) ? 1 : 0.75,
                                                borderBottom: "1px solid #1a2830",
                                            }}
                                            onClick={() => markAsRead(it.id)}
                                        >
                                            <span style={{ display: "block", color: "#e2edf3" }}>{it.text}</span>
                                            <span style={{ display: "block", fontSize: 11, marginTop: 4, color: "#5a7a8a" }}>
                                                {it.at != null ? formatTime(it.at) : ""}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                    <button type="button" style={itemStyle} onClick={markAllRead}>
                        Mark all as read
                    </button>
                    <button
                        type="button"
                        style={itemStyle}
                        onClick={() => {
                            markAllRead();
                            setOpen(false);
                        }}
                    >
                        Clear notifications
                    </button>
                </div>
            )}
        </div>
    );
}

export function HeaderSettingsNav({ className, children }) {
    const navigate = useNavigate();
    return (
        <button type="button" className={className} onClick={() => navigate("/settings")} aria-label="Settings">
            {children}
        </button>
    );
}

export function HeaderMenuButton({ className, children, labels = ["View (mock)", "Mark read (mock)"] }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        const fn = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", fn);
        return () => document.removeEventListener("mousedown", fn);
    }, []);
    useEffect(() => {
        const esc = (e) => {
            if (e.key === "Escape") setOpen(false);
        };
        if (open) document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [open]);
    return (
        <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
            <button type="button" className={className} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {children}
            </button>
            {open && (
                <div role="menu" style={panelStyle}>
                    {labels.map((t) => (
                        <button key={t} type="button" style={itemStyle} onClick={() => setOpen(false)}>
                            {t}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function HeaderMenuAvatar({ className, style, onLogout }) {
    const [open, setOpen] = useState(false);
    const [profileRev, setProfileRev] = useState(0);
    const navigate = useNavigate();
    const ref = useRef(null);

    useEffect(() => {
        const fn = () => setProfileRev((n) => n + 1);
        window.addEventListener("soc_profile_update", fn);
        return () => window.removeEventListener("soc_profile_update", fn);
    }, []);

    const userPanel = useMemo(() => sessionUserPanel(), [profileRev]);
    const stats = useMemo(() => {
        const cases = Array.isArray(getCases()) ? getCases().length : 0;
        const alerts = Array.isArray(getAlerts()) ? getAlerts().length : 0;
        return { cases, alerts };
    }, [profileRev]);

    const imgSrc = userPanel?.avatarUrl || null;
    const showInitials = !imgSrc && userPanel?.initials;
    const rt = (userPanel?.roleType || "").toLowerCase();
    const badgeClass = rt === "admin" ? "soc-role-badge admin" : rt === "viewer" ? "soc-role-badge viewer" : "soc-role-badge";
    const roleWithLevel = userPanel?.role ? `${userPanel.role}${rt === "analyst" ? " • L2" : ""}` : "";

    const triggerStyle = {
        ...style,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: imgSrc ? "#0f172a" : "linear-gradient(135deg,#1e3a5f,#0f172a)",
    };

    useEffect(() => {
        const fn = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", fn);
        return () => document.removeEventListener("mousedown", fn);
    }, []);
    useEffect(() => {
        const esc = (e) => {
            if (e.key === "Escape") setOpen(false);
        };
        if (open) document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [open]);
    return (
        <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
            <div
                role="button"
                tabIndex={0}
                className={`${className || ""} soc-avatar-trigger`.trim()}
                style={triggerStyle}
                onClick={() => setOpen((o) => !o)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((o) => !o)}
                aria-expanded={open}
            >
                {imgSrc ? (
                    <img src={imgSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : showInitials ? (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#e2edf3", userSelect: "none" }}>{userPanel.initials}</span>
                ) : null}
            </div>
            {open && (
                <div role="menu" style={{ ...panelStyle, minWidth: userPanel ? 240 : panelStyle.minWidth }}>
                    {userPanel && (
                        <div className="soc-profile-header">
                            <div className="soc-profile-user-row">
                                <span className="soc-user-status-dot" />
                                <span className="soc-profile-name">{userPanel.name}</span>
                            </div>
                            <div className="soc-profile-email">{userPanel.email}</div>
                            <span className={badgeClass}>{roleWithLevel}</span>
                            <div className="soc-profile-subtitle">Threat Monitoring & Response</div>
                            <div className="soc-profile-stats">
                                Cases: {stats.cases} <span>|</span> Alerts: {stats.alerts}
                            </div>
                            <div className="soc-profile-last-active">{formatRelativeLastActive(userPanel.lastLogin)}</div>
                        </div>
                    )}
                    <button
                        type="button"
                        style={itemStyle}
                        className="soc-profile-action"
                        onClick={() => {
                            setOpen(false);
                            navigate("/settings");
                        }}
                    >
                        <Settings size={14} />
                        <span>Edit Profile</span>
                    </button>
                    {typeof onLogout === "function" && (
                        <button
                            type="button"
                            className="soc-logout-btn soc-profile-action"
                            style={itemStyle}
                            onClick={() => {
                                setOpen(false);
                                onLogout();
                            }}
                        >
                            <LogOut size={14} />
                            <span>Logout</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
