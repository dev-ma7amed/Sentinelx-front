import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import {
    Shield, Search, Bell, Settings as SettingsIcon, Users, ShieldCheck,
    Puzzle, Key, History, UserPlus, User,
    Edit, MoreVertical, Trash2, X, Download
} from "lucide-react";
import "../styles/Settings.css";
import "../styles/ClassifyModal.css";
import { HeaderMenuAvatar, HeaderNotificationBell, HeaderSettingsNav } from "../components/MockHeaderMenu";
import { SocLogo } from "../components/SocLogo";
import { canMutateSettings, ensureSocUsers, getCurrentUser, logoutSession, patchCurrentUserContact, readSocUsers, roleLabelFromType, roleTypeFromLabel, writeSocUsers } from "../session";
import { readSocProfile, writeSocProfile } from "../socProfile";
import { pushAudit, pushNotification } from "../platformStore";
import {
    createDetectionRule,
    deleteDetectionRule,
    getBackendAuditLogs,
    getBackendIntegrations,
    getDetectionRules,
    toggleDetectionRule,
    updateBackendIntegration,
    updateDetectionRule,
    getUsersList,
    createUser,
    updateUser,
    deleteUser,
    toggleUserStatus,
    getApiKeysList,
    createApiKey,
    deleteApiKey,
} from "../api/socService";
import { formatTime } from "../utils/formatTime";

const USER_PAGE_SIZE = 5;
const LS_API_KEYS = "soc_api_keys";
const LS_SECURITY_TOGGLES = "soc_security_toggles";
const LS_IP_WHITELIST = "soc_ip_whitelist";

function integrationKey(name) {
    return name === "network_ml" ? "ml" : name;
}

function integrationApiName(key) {
    return key === "ml" ? "network_ml" : key;
}

function integrationMapFromList(list) {
    return (Array.isArray(list) ? list : []).reduce((acc, item) => {
        const key = integrationKey(item.name);
        acc[key] = !!item.enabled;
        return acc;
    }, {});
}

function normalizeAuditRow(row) {
    return {
        id: row.id,
        action: row.action,
        severity: row.details?.severity || "INFO",
        user: row.user?.name || "System",
        entity: row.entity_type,
        entityId: row.entity_id,
        message: row.message,
        ip: row.details?.ip || "—",
        timestamp: row.created_at,
        caseId: row.details?.case_id || "",
    };
}

function readApiKeys() {
    try {
        const raw = localStorage.getItem(LS_API_KEYS);
        if (raw) {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) return p;
        }
    } catch {
        /* ignore */
    }
    return [];
}

function writeApiKeys(list) {
    localStorage.setItem(LS_API_KEYS, JSON.stringify(list));
}

function readIpWhitelist() {
    try {
        const raw = localStorage.getItem(LS_IP_WHITELIST);
        if (raw) {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) return p;
        }
    } catch {
        /* ignore */
    }
    return ["127.0.0.1", "192.168.1.0/24"];
}

function writeIpWhitelist(list) {
    localStorage.setItem(LS_IP_WHITELIST, JSON.stringify(list));
}

const sidebarLinks = [
    { id: "profile", icon: <User size={18} />, label: "My Profile" },
    { id: "users", icon: <Users size={18} />, label: "User Management" },
    { id: "roles", icon: <ShieldCheck size={18} />, label: "Roles & Permissions" },
    { id: "security", icon: <Shield size={18} />, label: "Security Settings" },
    { id: "integrations", icon: <Puzzle size={18} />, label: "Integrations" },
    { id: "rules", icon: <ShieldCheck size={18} />, label: "Detection Rules" },
    { id: "keys", icon: <Key size={18} />, label: "API Keys" },
    { id: "auditlog", icon: <History size={18} />, label: "Audit Logs" },
];

const tabs = ["All Users (24)", "Active", "Suspended", "Admins"];

function mergeUsersSeed() {
    ensureSocUsers();
    return readSocUsers();
}

const securityTogglesSeed = [
    { label: "Multi-Factor Authentication", desc: "Enforce MFA for all platform users", defaultOn: true },
    { label: "Audit Log Retention", desc: "Store system logs for 90 days", defaultOn: true },
    { label: "Public API Access", desc: "Allow external requests via API tokens", defaultOn: false },
    { label: "IP Whitelisting", desc: "Restrict login to specific IP ranges", defaultOn: false },
];

function Toggle({ on, onToggle }) {
    return (
        <button type="button" className={`st-toggle ${on ? "on" : ""}`} onClick={onToggle}>
            <span className="st-toggle-thumb" />
        </button>
    );
}

export default function Settings() {
    const navigate = useNavigate();
    const canMutate = () => canMutateSettings();
    const [activeTab, setActiveTab] = useState(() => {
        const saved = sessionStorage.getItem("settings_active_tab");
        return saved ? parseInt(saved, 10) : 0;
    });
    const [search, setSearch] = useState("");
    const [activeSection, setActiveSection] = useState(() => {
        return sessionStorage.getItem("settings_active_section") || "profile";
    });

    useEffect(() => {
        sessionStorage.setItem("settings_active_tab", String(activeTab));
    }, [activeTab]);

    useEffect(() => {
        sessionStorage.setItem("settings_active_section", activeSection);
    }, [activeSection]);
    const [profileName, setProfileName] = useState(() => readSocProfile().name || "");
    const [profileEmail, setProfileEmail] = useState(() => readSocProfile().email || getCurrentUser()?.email || "");
    const [profileRole, setProfileRole] = useState(() => readSocProfile().role || "");
    const [profileAvatar, setProfileAvatar] = useState(() => readSocProfile().avatar || "");
    const [users, setUsers] = useState(() => mergeUsersSeed());
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [usersError, setUsersError] = useState("");
    const [securityToggles, setSecurityToggles] = useState(() => {
        try {
            const raw = localStorage.getItem(LS_SECURITY_TOGGLES);
            if (raw) {
                const p = JSON.parse(raw);
                if (Array.isArray(p) && p.length) return p;
            }
        } catch {
            /* ignore */
        }
        return securityTogglesSeed.map((t, i) => ({ ...t, id: t.id || `t-${i}`, on: t.defaultOn }));
    });
    const [apiKeys, setApiKeys] = useState([]);
    const [integrations, setIntegrationsState] = useState({});
    const [integrationRows, setIntegrationRows] = useState([]);
    const [detectionRules, setDetectionRules] = useState([]);
    const [operationsLoading, setOperationsLoading] = useState(false);
    const [auditLog, setAuditLog] = useState([]);
    const [ipWhitelist, setIpWhitelist] = useState(() => readIpWhitelist());
    const [newIpInput, setNewIpInput] = useState("");
    const [ipError, setIpError] = useState("");

    // Audit log filters
    const [auditLogs, setAuditLogs] = useState([]);
    const [auditSearch, setAuditSearch] = useState("");
    const [auditActionFilter, setAuditActionFilter] = useState("");
    const [auditSeverityFilter, setAuditSeverityFilter] = useState("");
    const [auditUserFilter, setAuditUserFilter] = useState("");
    const [auditFilterOptions, setAuditFilterOptions] = useState({ actions: [], users: [] });

    const [addUserOpen, setAddUserOpen] = useState(false);
    const [newUserName, setNewUserName] = useState("");
    const [newUserEmail, setNewUserEmail] = useState("");
    const [newUserRole, setNewUserRole] = useState("Analyst");
    const [newUserPassword, setNewUserPassword] = useState("");
    const [addUserError, setAddUserError] = useState("");

    const persistUsers = (next) => {
        setUsers(next);
        writeSocUsers(next);
    };

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = users;
        if (q) list = list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
        if (activeTab === 1) list = list.filter((u) => u.status === "active");
        if (activeTab === 2) list = list.filter((u) => u.status !== "active");
        if (activeTab === 3) list = list.filter((u) => (u.roleType || "").toLowerCase() === "admin");
        return list;
    }, [users, search, activeTab]);

    const filteredAuditLogs = useMemo(() => {
        const q = auditSearch.trim().toLowerCase();
        return auditLogs.filter((row) => {
            if (auditActionFilter && row.action !== auditActionFilter) return false;
            if (auditSeverityFilter && row.severity !== auditSeverityFilter) return false;
            if (auditUserFilter && row.user !== auditUserFilter) return false;
            if (!q) return true;
            return [row.action, row.entity, row.entityId, row.message, row.user]
                .some((value) => String(value || "").toLowerCase().includes(q));
        });
    }, [auditLogs, auditActionFilter, auditSeverityFilter, auditUserFilter, auditSearch]);

    const [userListPage, setUserListPage] = useState(1);
    const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / USER_PAGE_SIZE));
    const userPageSlice = filteredUsers.slice((userListPage - 1) * USER_PAGE_SIZE, userListPage * USER_PAGE_SIZE);

    useEffect(() => {
        setUserListPage(1);
    }, [search, activeTab, users.length]);

    useEffect(() => {
        setUserListPage((p) => Math.min(p, userPageCount));
    }, [userPageCount]);

    const loadUsers = async () => {
        setLoadingUsers(true);
        setUsersError("");
        try {
            const res = await getUsersList();
            const list = (Array.isArray(res) ? res : []).map((u) => {
                const name = u.name || "";
                const initials = name
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase())
                    .join("") || "U";
                let rawRoleName = u.role?.role || u.role?.name || u.role?.name?.en || "";
                if (rawRoleName && typeof rawRoleName === "object") {
                    rawRoleName = rawRoleName.en || rawRoleName.ar || "";
                }
                const roleStr = String(rawRoleName || "").toLowerCase();
                const roleType = roleStr.includes("admin") 
                    ? "admin" 
                    : (roleStr.includes("viewer") ? "viewer" : "analyst");
                const roleLabel = roleStr.includes("admin") 
                    ? "Admin" 
                    : (roleStr.includes("viewer") ? "Viewer" : "Analyst");
                return {
                    id: String(u.id),
                    initials,
                    name,
                    email: u.email || "",
                    role: roleLabel,
                    roleType,
                    status: u.status ? "active" : "inactive",
                    lastLogin: u.last_connected_at ? new Date(u.last_connected_at).toLocaleString() : "—",
                };
            });
            setUsers(list);
        } catch (err) {
            console.error("Failed to load users:", err);
            setUsersError("Failed to fetch users from backend. Displaying offline users.");
            setUsers(mergeUsersSeed());
        } finally {
            setLoadingUsers(false);
        }
    };

    useEffect(() => {


        loadUsers();

    }, []);

    useEffect(() => {
        if (!addUserOpen) return;
        const esc = (e) => {
            if (e.key === "Escape") setAddUserOpen(false);
        };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [addUserOpen]);

    useEffect(() => {
        if (activeSection !== "profile") return;
        const p = readSocProfile();
        setProfileName(p.name || "");
        setProfileEmail(p.email || getCurrentUser()?.email || "");
        setProfileRole(p.role || "");
        setProfileAvatar(p.avatar || "");
    }, [activeSection]);

    const loadOperationalSettings = async () => {
        setOperationsLoading(true);
        try {
            const [integrationsRes, rulesRes, auditRes, keysRes] = await Promise.all([
                getBackendIntegrations(),
                getDetectionRules(),
                getBackendAuditLogs({ per_page: 100 }),
                getApiKeysList(),
            ]);

            const integrationsList = Array.isArray(integrationsRes) ? integrationsRes : [];
            setIntegrationRows(integrationsList);
            setIntegrationsState(integrationMapFromList(integrationsList));
            setDetectionRules(Array.isArray(rulesRes) ? rulesRes : []);
            setApiKeys(Array.isArray(keysRes) ? keysRes : []);

            const rows = (Array.isArray(auditRes) ? auditRes : []).map(normalizeAuditRow);
            setAuditLogs(rows);
            setAuditLog(rows);
            setAuditFilterOptions({
                actions: [...new Set(rows.map((row) => row.action).filter(Boolean))],
                users: [...new Set(rows.map((row) => row.user).filter(Boolean))],
            });
        } catch (error) {
            console.error("Failed to load operational settings:", error);
            pushNotification("Failed to load backend settings");
        } finally {
            setOperationsLoading(false);
        }
    };

    useEffect(() => {
        loadOperationalSettings();
    }, []);

    // Listen for audit log updates
    useEffect(() => {
        const onAuditUpdate = () => loadOperationalSettings();

        window.addEventListener("soc_audit_update", onAuditUpdate);
        window.addEventListener("soc_system_refresh", onAuditUpdate);

        return () => {
            window.removeEventListener("soc_audit_update", onAuditUpdate);
            window.removeEventListener("soc_system_refresh", onAuditUpdate);
        };
    }, []);

    const saveDisplayProfile = () => {
        const em = profileEmail.trim();
        if (em && !/\S+@\S+\.\S+/.test(em)) {
            Swal.fire({
                title: 'Invalid Email',
                text: 'Please enter a valid email address.',
                icon: 'warning',
                background: '#121f28',
                color: '#fff',
                confirmButtonColor: '#2badee'
            });
            return;
        }
        writeSocProfile({
            name: profileName.trim(),
            role: profileRole.trim(),
            avatar: profileAvatar,
            email: em,
        });
        patchCurrentUserContact(profileName.trim(), em);
        addAudit("Display profile saved");
        pushNotification("Profile updated");
    };

    const onProfileAvatarFile = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => setProfileAvatar(String(reader.result || ""));
        reader.readAsDataURL(f);
    };

    const addAudit = (message) => {
        const row = pushAudit({ action: "settings", entityType: "settings", entityId: activeSection, message });
        setAuditLog((prev) => [row, ...(prev || [])]);
    };

    const handleAddIp = () => {
        const ip = newIpInput.trim();
        if (!ip) {
            setIpError("IP address is required");
            return;
        }
        if (ipWhitelist.includes(ip)) {
            setIpError("IP already in whitelist");
            return;
        }
        const updated = [...ipWhitelist, ip];
        setIpWhitelist(updated);
        writeIpWhitelist(updated);
        setNewIpInput("");
        setIpError("");
        addAudit(`IP whitelist updated - Added ${ip}`);
        pushNotification(`IP ${ip} added to whitelist`);
        window.dispatchEvent(new Event("soc_system_refresh"));
    };

    const handleRemoveIp = (ip) => {
        const updated = ipWhitelist.filter(i => i !== ip);
        setIpWhitelist(updated);
        writeIpWhitelist(updated);
        addAudit(`IP whitelist updated - Removed ${ip}`);
        pushNotification(`IP ${ip} removed from whitelist`);
        window.dispatchEvent(new Event("soc_system_refresh"));
    };

    const handleToggleSecurity = (idx) => {
        const updated = securityToggles.map((t, i) =>
            i === idx ? { ...t, on: !t.on } : t
        );
        setSecurityToggles(updated);
        localStorage.setItem(LS_SECURITY_TOGGLES, JSON.stringify(updated));
        const toggle = updated[idx];
        addAudit(`Security setting "${toggle.label}" ${toggle.on ? "enabled" : "disabled"}`);
        pushNotification(`${toggle.label} ${toggle.on ? "enabled" : "disabled"}`);
        window.dispatchEvent(new Event("soc_system_refresh"));
    };

    const handleExportLogs = () => {
        try {
            const logsToExport = filteredAuditLogs && filteredAuditLogs.length > 0 ? filteredAuditLogs : auditLogs;

            if (!logsToExport.length) {
                pushNotification("No audit logs available to export");
                return;
            }

            const headers = ["action", "severity", "user", "entity", "message", "ip", "timestamp", "caseId"];

            const escapeCSV = (value) => {
                if (value === null || value === undefined) return "";
                return `"${String(value).replace(/"/g, '""')}"`;
            };

            const rows = logsToExport.map((log) =>
                [
                    escapeCSV(log.action),
                    escapeCSV(log.severity),
                    escapeCSV(log.user),
                    escapeCSV(log.entity),
                    escapeCSV(log.message),
                    escapeCSV(log.ip),
                    escapeCSV(log.timestamp),
                    escapeCSV(log.caseId),
                ].join(",")
            );

            const csvContent = [headers.join(","), ...rows].join("\n");

            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `audit_logs_${new Date().toISOString().split("T")[0]}.csv`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);

            pushNotification("Audit logs exported successfully");
            addAudit("Audit logs exported");
        } catch (error) {
            console.error("Export failed:", error);
            pushNotification("Failed to export audit logs");
        }
    };

    const handleAddUser = () => {
        setNewUserName("");
        setNewUserEmail("");
        setNewUserRole("Analyst");
        setNewUserPassword("");
        setAddUserError("");
        setAddUserOpen(true);
    };

    const submitNewUser = async () => {
        setAddUserError("");
        const name = newUserName.trim();
        const email = newUserEmail.trim();
        const password = newUserPassword.trim();
        if (!name || !email) {
            setAddUserError("Name and email are required.");
            return;
        }
        if (!/\S+@\S+\.\S+/.test(email)) {
            setAddUserError("Enter a valid email.");
            return;
        }
        if (password.length < 8) {
            setAddUserError("Password must be at least 8 characters.");
            return;
        }
        const role = newUserRole || "Analyst";
        const roleType = roleTypeFromLabel(role);

        setLoadingUsers(true);
        try {
            await createUser({
                name,
                email,
                password,
                role: roleLabelFromType(roleType),
            });
            pushNotification("User created successfully");
            setAddUserOpen(false);
            await loadUsers();
        } catch (err) {
            console.error("Failed to create user:", err);
            setAddUserError(err.message || "Failed to create user on backend.");
        } finally {
            setLoadingUsers(false);
        }
    };

    const handleEditUser = async (u) => {
        if (!canMutate()) return;

        Swal.fire({
            title: 'Edit User Info',
            html: `
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Full Name</label>
                    <input id="swal-input-name" class="swal2-input" value="${u.name || ''}" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px;">
                </div>
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Email Address</label>
                    <input id="swal-input-email" class="swal2-input" value="${u.email || ''}" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px;">
                </div>
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Role Type</label>
                    <select id="swal-input-role" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px; height: auto;">
                        <option value="Admin" ${(u.role || '').toLowerCase() === 'admin' ? 'selected' : ''}>SOC Administrator</option>
                        <option value="Analyst" ${(u.role || '').toLowerCase() === 'analyst' ? 'selected' : ''}>SOC Analyst</option>
                        <option value="Viewer" ${(u.role || '').toLowerCase() === 'viewer' ? 'selected' : ''}>SOC Viewer</option>
                    </select>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Save Changes',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#2badee',
            cancelButtonColor: '#1a2c38',
            customClass: {
                popup: 'swal-enterprise-dark',
            },
            preConfirm: () => {
                const name = document.getElementById('swal-input-name').value;
                const email = document.getElementById('swal-input-email').value;
                const role = document.getElementById('swal-input-role').value;
                if (!name || !name.trim()) {
                    Swal.showValidationMessage('Full name is required');
                    return false;
                }
                if (!email || !email.trim()) {
                    Swal.showValidationMessage('Email address is required');
                    return false;
                }
                return { name, email, role };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const { name, email, role } = result.value;
                const roleType = roleTypeFromLabel(role);

                setLoadingUsers(true);
                try {
                    await updateUser(u.id, {
                        name: String(name).trim(),
                        email: String(email).trim(),
                        role: roleLabelFromType(roleType),
                    });
                    pushNotification("User updated successfully");
                    await loadUsers();
                } catch (err) {
                    console.error("Failed to update user:", err);
                    Swal.fire({
                        title: 'Error',
                        text: err.message || "Failed to update user on backend.",
                        icon: 'error',
                        background: '#121f28',
                        color: '#fff',
                        confirmButtonColor: '#2badee'
                    });
                } finally {
                    setLoadingUsers(false);
                }
            }
        });
    };

    const handleMoreUserAction = async (u) => {
        if (!canMutate()) return;
        const isSuspended = u.status === "inactive" || u.status === "suspended";
        const toggleText = isSuspended ? "Resume User" : "Suspend User";

        Swal.fire({
            title: 'User Management Actions',
            text: `Select an action to perform on ${u.name}`,
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: toggleText,
            denyButtonText: 'Delete User',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: isSuspended ? '#0bda57' : '#facc15',
            denyButtonColor: '#ef4444',
            cancelButtonColor: '#1a2c38',
            customClass: {
                popup: 'swal-enterprise-dark',
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                setLoadingUsers(true);
                try {
                    await toggleUserStatus(u.id);
                    pushNotification(`User ${isSuspended ? "resumed" : "suspended"} successfully`);
                    await loadUsers();
                } catch (err) {
                    console.error("Failed to toggle user status:", err);
                    Swal.fire({
                        title: 'Error',
                        text: err.message || "Failed to toggle status on backend.",
                        icon: 'error',
                        background: '#121f28',
                        color: '#fff',
                        confirmButtonColor: '#2badee'
                    });
                } finally {
                    setLoadingUsers(false);
                }
            } else if (result.isDenied) {
                Swal.fire({
                    title: 'Delete User?',
                    text: `Are you sure you want to permanently delete user "${u.name}"? This action cannot be undone.`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, Delete',
                    cancelButtonText: 'Cancel',
                    background: '#121f28',
                    color: '#fff',
                    confirmButtonColor: '#ef4444',
                    cancelButtonColor: '#1a2c38'
                }).then(async (delResult) => {
                    if (delResult.isConfirmed) {
                        setLoadingUsers(true);
                        try {
                            await deleteUser(u.id);
                            pushNotification("User deleted successfully");
                            await loadUsers();
                        } catch (err) {
                            console.error("Failed to delete user:", err);
                            Swal.fire({
                                title: 'Error',
                                text: err.message || "Failed to delete user on backend.",
                                icon: 'error',
                                background: '#121f28',
                                color: '#fff',
                                confirmButtonColor: '#2badee'
                            });
                        } finally {
                            setLoadingUsers(false);
                        }
                    }
                });
            }
        });
    };

    const handleToggle = (id) => {
        setSecurityToggles((prev) => {
            const next = prev.map((t) => (t.id === id ? { ...t, on: !t.on } : t));
            localStorage.setItem(LS_SECURITY_TOGGLES, JSON.stringify(next));
            return next;
        });
        addAudit("Toggle updated (simulated)");
    };

    const toggleIntegration = async (key, label) => {
        const nextVal = !integrations?.[key];
        const previous = { ...integrations };
        setIntegrationsState({ ...previous, [key]: nextVal });

        try {
            const updated = await updateBackendIntegration(integrationApiName(key), { enabled: nextVal });
            setIntegrationRows((prev) => prev.map((item) => item.name === updated.name ? updated : item));
            setIntegrationsState((prev) => ({ ...prev, [key]: !!updated.enabled }));
            pushNotification(`${label || key} ${updated.enabled ? "enabled" : "disabled"}`);
            await loadOperationalSettings();
        } catch (error) {
            console.error("Failed to update integration:", error);
            setIntegrationsState(previous);
            pushNotification(`Failed to update ${label || key}`);
        }
    };

    const refreshRules = async () => {
        try {
            const rows = await getDetectionRules();
            setDetectionRules(Array.isArray(rows) ? rows : []);
        } catch (error) {
            console.error("Failed to refresh detection rules:", error);
            pushNotification("Failed to load detection rules");
        }
    };

    const handleCreateRule = async () => {
        if (!canMutate()) return;

        Swal.fire({
            title: 'Create Detection Rule',
            html: `
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Rule Name</label>
                    <input id="swal-rule-name" class="swal2-input" placeholder="e.g. Detect Brute Force" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px;">
                </div>
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Field Match Expression</label>
                    <input id="swal-rule-match" class="swal2-input" value="title CONTAINS 'Suspicious'" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px;">
                </div>
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Severity Override</label>
                    <select id="swal-rule-severity" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px; height: auto;">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high" selected>High</option>
                        <option value="critical">Critical</option>
                    </select>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Create Rule',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#2badee',
            cancelButtonColor: '#1a2c38',
            customClass: {
                popup: 'swal-enterprise-dark',
            },
            preConfirm: () => {
                const name = document.getElementById('swal-rule-name').value;
                const fieldMatch = document.getElementById('swal-rule-match').value;
                const severity = document.getElementById('swal-rule-severity').value;
                if (!name || !name.trim()) {
                    Swal.showValidationMessage('Rule name is required');
                    return false;
                }
                if (!fieldMatch || !fieldMatch.trim()) {
                    Swal.showValidationMessage('Field match expression is required');
                    return false;
                }
                return { name, fieldMatch, severity };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const { name, fieldMatch, severity } = result.value;
                try {
                    await createDetectionRule({
                        name: name.trim(),
                        field_match: fieldMatch.trim(),
                        severity_override: severity.toLowerCase(),
                        threshold_count: 1,
                        time_window_seconds: 60,
                        cooldown_seconds: 0,
                        priority: 100,
                    });
                    pushNotification(`Detection rule ${name} created`);
                    await refreshRules();
                } catch (error) {
                    console.error("Failed to create detection rule:", error);
                    pushNotification("Failed to create detection rule");
                }
            }
        });
    };

    const handleEditRule = async (rule) => {
        if (!canMutate()) return;

        Swal.fire({
            title: 'Edit Detection Rule',
            html: `
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Rule Name</label>
                    <input id="swal-rule-name" class="swal2-input" value="${rule.name || ''}" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px;" disabled>
                </div>
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Field Match Expression</label>
                    <input id="swal-rule-match" class="swal2-input" value="${rule.field_match || ''}" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px;">
                </div>
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Severity Override</label>
                    <select id="swal-rule-severity" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px; height: auto;">
                        <option value="low" ${rule.severity_override === "low" ? "selected" : ""}>Low</option>
                        <option value="medium" ${rule.severity_override === "medium" ? "selected" : ""}>Medium</option>
                        <option value="high" ${rule.severity_override === "high" ? "selected" : ""}>High</option>
                        <option value="critical" ${rule.severity_override === "critical" ? "selected" : ""}>Critical</option>
                    </select>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Save Rule',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#2badee',
            cancelButtonColor: '#1a2c38',
            customClass: {
                popup: 'swal-enterprise-dark',
            },
            preConfirm: () => {
                const fieldMatch = document.getElementById('swal-rule-match').value;
                const severity = document.getElementById('swal-rule-severity').value;
                if (!fieldMatch || !fieldMatch.trim()) {
                    Swal.showValidationMessage('Field match expression is required');
                    return false;
                }
                return { fieldMatch, severity };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const { fieldMatch, severity } = result.value;
                try {
                    await updateDetectionRule(rule.id, {
                        name: rule.name,
                        source: rule.source,
                        field_match: fieldMatch.trim(),
                        severity_override: severity,
                        threshold_count: rule.threshold_count,
                        time_window_seconds: rule.time_window_seconds,
                        cooldown_seconds: rule.cooldown_seconds,
                        priority: rule.priority,
                        active: rule.active,
                    });
                    pushNotification(`Detection rule ${rule.name} updated`);
                    await refreshRules();
                } catch (error) {
                    console.error("Failed to update detection rule:", error);
                    pushNotification("Failed to update detection rule");
                }
            }
        });
    };

    const handleToggleRule = async (rule) => {
        if (!canMutate()) return;
        try {
            const updated = await toggleDetectionRule(rule.id);
            setDetectionRules((prev) => prev.map((item) => item.id === rule.id ? { ...item, active: updated.active } : item));
        } catch (error) {
            console.error("Failed to toggle detection rule:", error);
            pushNotification("Failed to toggle detection rule");
        }
    };

    const handleDeleteRule = async (rule) => {
        if (!canMutate()) return;

        Swal.fire({
            title: 'Delete Detection Rule?',
            text: `Are you sure you want to delete rule "${rule.name}"? This action cannot be undone.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Delete',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#1a2c38'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    await deleteDetectionRule(rule.id);
                    setDetectionRules((prev) => prev.filter((item) => item.id !== rule.id));
                    pushNotification(`Detection rule ${rule.name} deleted`);
                } catch (error) {
                    console.error("Failed to delete detection rule:", error);
                    pushNotification(rule.is_system ? "System rules cannot be deleted" : "Failed to delete detection rule");
                }
            }
        });
    };

    const handleAddApiKey = () => {
        if (!canMutate()) return;

        Swal.fire({
            title: 'Create API Key',
            html: `
                <div class="swal-field-group" style="text-align: left; margin-bottom: 15px;">
                    <label style="display: block; font-size: 13px; color: #92b7c9; margin-bottom: 5px;">Key Name</label>
                    <input id="swal-key-name" class="swal2-input" placeholder="e.g. Production Webhook" style="margin: 0; width: 100%; box-sizing: border-box; background: #0b1319; color: #fff; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px;">
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Generate Key',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#2badee',
            cancelButtonColor: '#1a2c38',
            customClass: {
                popup: 'swal-enterprise-dark',
            },
            preConfirm: () => {
                const name = document.getElementById('swal-key-name').value;
                if (!name || !name.trim()) {
                    Swal.showValidationMessage('Key name is required');
                    return false;
                }
                return name.trim();
            }
        }).then(async (result) => {
            if (result.isConfirmed && result.value) {
                const name = result.value;
                try {
                    Swal.fire({
                        title: 'Generating Key...',
                        text: 'Registering new dynamic token on the SOC backend.',
                        allowOutsideClick: false,
                        didOpen: () => {
                            Swal.showLoading();
                        }
                    });

                    const res = await createApiKey({ name });
                    
                    if (res && res.plaintext_key) {
                        Swal.fire({
                            title: 'Key Generated Successfully!',
                            html: `
                                <div style="text-align: left; margin-bottom: 15px;">
                                    <p style="font-size: 13px; color: #92b7c9; margin-bottom: 8px;">
                                        <strong>Copy this key now.</strong> For security, you will not be able to view it again!
                                    </p>
                                    <div style="position: relative; display: flex; gap: 8px;">
                                        <input type="text" id="swal-key-copy" class="swal2-input" value="${res.plaintext_key}" readonly style="margin: 0; flex: 1; font-family: monospace; background: #0b1319; color: #0bda57; border: 1px solid #1a2c38; border-radius: 4px; padding: 10px; font-size: 13px;">
                                        <button type="button" onclick="navigator.clipboard.writeText('${res.plaintext_key}'); this.textContent='Copied!';" style="background: #2badee; color: #fff; border: none; padding: 0 15px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer;">Copy</button>
                                    </div>
                                </div>
                            `,
                            confirmButtonText: 'I Have Copied It',
                            background: '#121f28',
                            color: '#fff',
                            confirmButtonColor: '#2badee',
                            customClass: {
                                popup: 'swal-enterprise-dark',
                            }
                        });

                        pushNotification(`API key ${name} created successfully.`);
                        loadOperationalSettings();
                    }
                } catch (err) {
                    Swal.fire({
                        title: 'Generation Failed',
                        text: err.message || 'Could not register key on backend.',
                        icon: 'error',
                        background: '#121f28',
                        color: '#fff',
                        confirmButtonColor: '#ef4444'
                    });
                }
            }
        });
    };

    const handleDeleteApiKey = (id) => {
        if (!canMutate()) return;

        Swal.fire({
            title: 'Revoke API Key?',
            text: 'Are you sure you want to permanently revoke this API key? External sensors using this key will immediately be blocked from sending logs!',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Revoke',
            cancelButtonText: 'Cancel',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#1a2c38',
            customClass: {
                popup: 'swal-enterprise-dark',
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    Swal.fire({
                        title: 'Revoking Key...',
                        allowOutsideClick: false,
                        didOpen: () => {
                            Swal.showLoading();
                        }
                    });

                    await deleteApiKey(id);

                    Swal.fire({
                        title: 'Revoked',
                        text: 'API Key has been successfully invalidated on the backend.',
                        icon: 'success',
                        background: '#121f28',
                        color: '#fff',
                        confirmButtonColor: '#2badee'
                    });

                    pushNotification("API key successfully revoked.");
                    loadOperationalSettings();
                } catch (err) {
                    Swal.fire({
                        title: 'Revocation Failed',
                        text: err.message || 'Could not invalidate key on backend.',
                        icon: 'error',
                        background: '#121f28',
                        color: '#fff',
                        confirmButtonColor: '#ef4444'
                    });
                }
            }
        });
    };

    return (
        <div className="st-page">

            {/* TOPBAR */}
            <header className="st-topbar">
                <div className="st-topbar-left">
                    <div className="st-logo">
                        <SocLogo />
                    </div>
                    {(() => {
                        const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
                        const roleType = (user.roleType || "analyst").toLowerCase();
                        return (
                            <nav className="st-topnav">
                                <NavLink to="/dashboard">Dashboard</NavLink>
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/alerts">Alerts</NavLink>}
                                <NavLink to="/incidents">Incidents</NavLink>
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/intelligence">Intelligence</NavLink>}
                                {(roleType === "admin" || roleType === "analyst") && <NavLink to="/cases">Cases</NavLink>}
                                {roleType === "admin" && <NavLink to="/audit">Audit & Metrics</NavLink>}
                                {roleType === "admin" && <NavLink to="/settings" className="active">Settings</NavLink>}
                            </nav>
                        );
                    })()}
                </div>
                <div className="st-topbar-right">
                    <div className="st-search">
                        <Search size={16} />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search settings..." />
                    </div>
                    <div className="st-icon-btns">
                        <HeaderNotificationBell className="st-icon-btn">
                            <Bell size={18} />
                        </HeaderNotificationBell>
                        <HeaderSettingsNav className="st-icon-btn">
                            <SettingsIcon size={18} />
                        </HeaderSettingsNav>
                    </div>
                    <HeaderMenuAvatar
                        className="st-avatar"
                        onLogout={() => { logoutSession(); navigate("/"); }}
                    />
                </div>
            </header>

            <div className="st-body">

                {/* SIDEBAR */}
                <aside className="st-sidebar">
                    <div className="st-sidebar-brand">
                        <h1>System Settings</h1>
                        <p>Platform Configuration</p>
                    </div>
                    <nav className="st-sidebar-nav">
                        {sidebarLinks.map((item) => (
                            <div
                                key={item.id}
                                role="button"
                                tabIndex={0}
                                className={`st-nav-item ${activeSection === item.id ? "active" : ""}`}
                                onClick={() => setActiveSection(item.id)}
                                onKeyDown={(e) => e.key === "Enter" && setActiveSection(item.id)}
                            >
                                {item.icon}<span>{item.label}</span>
                            </div>
                        ))}
                    </nav>
                </aside>

                {/* MAIN */}
                <main className="st-main">
                    <div className="st-container">

                        {/* HEADING */}
                        <div className="st-heading">
                            <div>
                                <h2>
                                    {activeSection === "profile"
                                        ? "My Profile"
                                        : activeSection === "users"
                                            ? "User Management"
                                            : activeSection === "roles"
                                                ? "Roles & Permissions"
                                                : activeSection === "integrations"
                                                    ? "Integrations"
                                                    : activeSection === "rules"
                                                        ? "Detection Rules"
                                                        : activeSection === "keys"
                                                            ? "API Keys"
                                                            : "Audit Logs"}
                                </h2>
                                <p>
                                    {activeSection === "profile"
                                        ? "How you appear in the header menu (name, role label, avatar). Stored locally in this browser."
                                        : activeSection === "users"
                                            ? "Manage team members and define their access levels to the SOC environment."
                                            : activeSection === "roles"
                                                ? "Security toggles and permission templates."
                                                : activeSection === "integrations"
                                                    ? "Manage backend-persisted source and intelligence integrations."
                                                    : activeSection === "rules"
                                                        ? "Manage server-side detection rules evaluated during alert correlation."
                                                        : activeSection === "keys"
                                                            ? "Create, manage, and revoke API keys."
                                                            : "Configuration change history from the backend audit log."}
                                </p>
                            </div>
                            {activeSection === "users" && (
                                <button type="button" className="st-add-btn" onClick={handleAddUser} disabled={!canMutate()}>
                                    <UserPlus size={18} />Add New User
                                </button>
                            )}
                        </div>

                        {activeSection === "profile" && (
                            <div className="st-section" style={{ marginBottom: 24 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 440 }}>
                                    <label className="st-toggle-desc" htmlFor="soc-prof-name">Display name</label>
                                    <input
                                        id="soc-prof-name"
                                        type="text"
                                        value={profileName}
                                        onChange={(e) => setProfileName(e.target.value)}
                                        className="st-profile-input"
                                        autoComplete="name"
                                    />
                                    <label className="st-toggle-desc" htmlFor="soc-prof-email">Work email</label>
                                    <input
                                        id="soc-prof-email"
                                        type="email"
                                        value={profileEmail}
                                        onChange={(e) => setProfileEmail(e.target.value)}
                                        className="st-profile-input"
                                        autoComplete="email"
                                    />
                                    <label className="st-toggle-desc" htmlFor="soc-prof-role">Role label</label>
                                    <input
                                        id="soc-prof-role"
                                        type="text"
                                        value={profileRole}
                                        onChange={(e) => setProfileRole(e.target.value)}
                                        className="st-profile-input"
                                        placeholder="SOC Analyst"
                                    />
                                    <label className="st-toggle-desc" htmlFor="soc-prof-avatar">Profile photo</label>
                                    <input id="soc-prof-avatar" type="file" accept="image/*" onChange={onProfileAvatarFile} className="st-profile-file" />
                                    {profileAvatar ? (
                                        <img src={profileAvatar} alt="" className="st-profile-preview" />
                                    ) : null}
                                    <button type="button" className="st-add-btn" onClick={saveDisplayProfile}>
                                        Save profile
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeSection === "users" && loadingUsers ? <p className="st-toggle-desc">Loading users...</p> : null}
                        {activeSection === "users" && usersError ? <p className="st-toggle-desc">{usersError}</p> : null}

                        {/* TABS */}
                        <div className="st-tabs" style={{ display: activeSection === "users" ? undefined : "none" }}>
                            {tabs.map((tab, i) => (
                                <button
                                    key={`tab-${tab}-${i}`}
                                    className={`st-tab ${activeTab === i ? "active" : ""}`}
                                    onClick={() => setActiveTab(i)}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* TABLE */}
                        <div className="st-table-card" style={{ display: activeSection === "users" ? undefined : "none" }}>
                            <div className="st-table-scroll">
                                <table className="st-table">
                                    <thead>
                                        <tr>
                                            <th>User Info</th>
                                            <th>Role</th>
                                            <th>Status</th>
                                            <th>Last Login</th>
                                            <th className="st-th-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {userPageSlice.length === 0 ? (
                                            <tr className="st-row"><td colSpan={5}><p className="st-toggle-desc">No data available</p></td></tr>
                                        ) : userPageSlice.map((u) => (
                                            <tr key={u.id} className="st-row">
                                                <td>
                                                    <div className="st-user-info">
                                                        <div className={`st-avatar-initials ${(u.roleType || "").toLowerCase() === "admin" ? "admin" : ""}`}>
                                                            {u.initials}
                                                        </div>
                                                        <div>
                                                            <p className="st-user-name">{u.name}</p>
                                                            <p className="st-user-email">{u.email}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`st-role-badge ${(u.roleType || "").toLowerCase() === "admin" ? "role-admin" : "role-default"}`}>
                                                        {u.role}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="st-status">
                                                        <span className={`st-status-dot ${u.status}`} />
                                                        <span className={u.status === "inactive" ? "st-status-inactive" : ""}>
                                                            {u.status === "active" ? "Active" : "Suspended"}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="st-last-login">{u.lastLogin}</td>
                                                <td className="st-td-right">
                                                    <div className="st-row-actions">
                                                        <button type="button" className="st-action-btn" onClick={() => handleEditUser(u)} aria-label="Edit" disabled={!canMutate()}><Edit size={16} /></button>
                                                        <button type="button" className="st-action-btn" onClick={() => handleMoreUserAction(u)} aria-label="More actions" disabled={!canMutate()}><MoreVertical size={16} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="st-table-footer">
                                <span>
                                    {filteredUsers.length === 0
                                        ? "No users"
                                        : `Showing ${(userListPage - 1) * USER_PAGE_SIZE + 1}-${Math.min(userListPage * USER_PAGE_SIZE, filteredUsers.length)} of ${filteredUsers.length} users`}
                                </span>
                                <div className="st-table-pagination">
                                    <button type="button" className="st-page-btn" disabled={userListPage <= 1} onClick={() => setUserListPage((p) => Math.max(1, p - 1))}>Previous</button>
                                    <button type="button" className="st-page-btn primary" disabled={userListPage >= userPageCount} onClick={() => setUserListPage((p) => Math.min(userPageCount, p + 1))}>Next</button>
                                </div>
                            </div>
                        </div>

                        {/* SECURITY SETTINGS */}
                        <div className="st-section" style={{ display: activeSection === "roles" ? undefined : "none" }}>
                            <h3>Roles & Permissions</h3>
                            <p className="st-toggle-desc" style={{ marginBottom: "16px" }}>Manage user roles, access levels, and permission templates for SOC operations.</p>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                                <div style={{
                                    padding: "16px",
                                    background: "rgba(43, 173, 238, 0.05)",
                                    border: "1px solid var(--border)",
                                    borderRadius: "8px"
                                }}>
                                    <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text)", marginBottom: "8px" }}>Administrator</p>
                                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Full platform access, user management, settings configuration</p>
                                </div>

                                <div style={{
                                    padding: "16px",
                                    background: "rgba(43, 173, 238, 0.05)",
                                    border: "1px solid var(--border)",
                                    borderRadius: "8px"
                                }}>
                                    <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text)", marginBottom: "8px" }}>SOC Analyst</p>
                                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Case management, incident triage, escalation authority</p>
                                </div>

                                <div style={{
                                    padding: "16px",
                                    background: "rgba(43, 173, 238, 0.05)",
                                    border: "1px solid var(--border)",
                                    borderRadius: "8px"
                                }}>
                                    <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text)", marginBottom: "8px" }}>Viewer</p>
                                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Read-only access to cases, incidents, and audit logs</p>
                                </div>

                                <div style={{
                                    padding: "16px",
                                    background: "rgba(43, 173, 238, 0.05)",
                                    border: "1px solid var(--border)",
                                    borderRadius: "8px"
                                }}>
                                    <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text)", marginBottom: "8px" }}>SOC Lead</p>
                                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Escalation approval, team oversight, case reassignment</p>
                                </div>
                            </div>

                            <div style={{ marginTop: "24px", borderTop: "1px solid var(--border)", paddingTop: "24px" }}>
                                <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "var(--text)" }}>Permission Matrix</h4>
                                <p className="st-toggle-desc" style={{ marginBottom: "12px" }}>Security settings and access controls are managed in the Security Settings section.</p>
                            </div>
                        </div>

                        {/* SECURITY SETTINGS */}
                        <div className="st-section" style={{ display: activeSection === "security" ? undefined : "none" }}>
                            <h3>Enterprise Security</h3>

                            <div style={{ marginBottom: "32px" }}>
                                <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "var(--text)" }}>Security Toggles</h4>
                                <div className="st-toggles-grid">
                                    {securityToggles.map((t, idx) => (
                                        <div key={t.id} className="st-toggle-card">
                                            <div>
                                                <p className="st-toggle-label">{t.label}</p>
                                                <p className="st-toggle-desc">{t.desc}</p>
                                            </div>
                                            <Toggle on={t.on} onToggle={() => { if (!canMutate()) return; handleToggleSecurity(idx); }} />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "24px" }}>
                                <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "var(--text)" }}>IP Whitelist</h4>
                                <p className="st-toggle-desc" style={{ marginBottom: "16px" }}>Restrict access to specific IP addresses or ranges</p>

                                <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                                    <input
                                        type="text"
                                        value={newIpInput}
                                        onChange={(e) => { setNewIpInput(e.target.value); setIpError(""); }}
                                        placeholder="e.g., 192.168.1.5 or 10.0.0.0/24"
                                        style={{
                                            flex: 1,
                                            padding: "10px 12px",
                                            background: "var(--bg-input)",
                                            border: "1px solid var(--border)",
                                            borderRadius: "8px",
                                            color: "var(--text)",
                                            fontSize: "13px"
                                        }}
                                        disabled={!canMutate()}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddIp}
                                        disabled={!canMutate() || !newIpInput.trim()}
                                        style={{
                                            padding: "10px 16px",
                                            background: "var(--accent-blue)",
                                            color: "white",
                                            border: "none",
                                            borderRadius: "8px",
                                            cursor: "pointer",
                                            fontSize: "13px",
                                            fontWeight: "600",
                                            opacity: !canMutate() || !newIpInput.trim() ? 0.5 : 1
                                        }}
                                    >
                                        Add IP
                                    </button>
                                </div>

                                {ipError && (
                                    <p style={{ color: "#ff5c5c", fontSize: "12px", marginBottom: "12px" }}>{ipError}</p>
                                )}

                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {ipWhitelist.length === 0 ? (
                                        <p className="st-toggle-desc">No IPs whitelisted</p>
                                    ) : (
                                        ipWhitelist.map((ip) => (
                                            <div
                                                key={ip}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    padding: "12px",
                                                    background: "rgba(43, 173, 238, 0.05)",
                                                    border: "1px solid var(--border)",
                                                    borderRadius: "8px"
                                                }}
                                            >
                                                <span style={{ fontSize: "13px", color: "var(--text)" }}>{ip}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveIp(ip)}
                                                    disabled={!canMutate()}
                                                    style={{
                                                        background: "transparent",
                                                        border: "none",
                                                        color: "#ff5c5c",
                                                        cursor: "pointer",
                                                        padding: "4px 8px",
                                                        opacity: !canMutate() ? 0.5 : 1
                                                    }}
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* INTEGRATIONS */}
                        <div className="st-section" style={{ display: activeSection === "integrations" ? undefined : "none" }}>
                            <h3>Integrations</h3>
                            {operationsLoading ? <p className="st-toggle-desc">Loading integrations...</p> : null}
                            <div className="st-toggles-grid">
                                {[
                                    { key: "wazuh", label: "Wazuh" },
                                    { key: "sysmon", label: "Sysmon" },
                                    { key: "suricata", label: "Suricata" },
                                    { key: "ml", label: "Network ML" },
                                    { key: "virustotal", label: "VirusTotal" },
                                    { key: "abuseipdb", label: "AbuseIPDB" },
                                ].map(({ key, label }) => (
                                    <div key={key} className="st-toggle-card">
                                        <div>
                                            <p className="st-toggle-label">{label}</p>
                                            <p className="st-toggle-desc">
                                                Status: {integrations?.[key] ? "connected" : "disconnected"}
                                                {integrationRows.find((row) => integrationKey(row.name) === key)?.has_key ? " · API key stored" : ""}
                                            </p>
                                        </div>
                                        <Toggle on={!!integrations?.[key]} onToggle={() => { if (!canMutate()) return; toggleIntegration(key, label); }} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* DETECTION RULES */}
                        <div className="st-section" style={{ display: activeSection === "rules" ? undefined : "none" }}>
                            <div className="st-section-header">
                                <h3>Detection Rules</h3>
                                <button type="button" className="st-link-btn" onClick={handleCreateRule} disabled={!canMutate()}>
                                    Add Rule
                                </button>
                            </div>
                            {operationsLoading ? <p className="st-toggle-desc">Loading detection rules...</p> : null}
                            <div className="st-table-card">
                                <div className="st-table-scroll">
                                    <table className="st-table">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                <th>Source</th>
                                                <th>Severity</th>
                                                <th>Triggers</th>
                                                <th>Status</th>
                                                <th className="st-th-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detectionRules.length === 0 ? (
                                                <tr className="st-row"><td colSpan={6}><p className="st-toggle-desc">No detection rules found</p></td></tr>
                                            ) : detectionRules.map((rule) => (
                                                <tr key={rule.id} className="st-row">
                                                    <td>
                                                        <p className="st-user-name">{rule.name}</p>
                                                        <p className="st-user-email">{rule.field_match}</p>
                                                    </td>
                                                    <td>{rule.source || "All sources"}</td>
                                                    <td>{rule.severity_override || "No override"}</td>
                                                    <td>{rule.trigger_count || 0}</td>
                                                    <td>
                                                        <Toggle on={!!rule.active} onToggle={() => handleToggleRule(rule)} />
                                                    </td>
                                                    <td className="st-td-right">
                                                        <div className="st-row-actions">
                                                            <button type="button" className="st-action-btn" onClick={() => handleEditRule(rule)} disabled={!canMutate()} aria-label="Edit rule"><Edit size={16} /></button>
                                                            <button type="button" className="st-action-btn" onClick={() => handleDeleteRule(rule)} disabled={!canMutate()} aria-label="Delete rule"><Trash2 size={16} /></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {/* API KEYS */}
                        <div className="st-section" style={{ display: activeSection === "keys" ? undefined : "none" }}>
                            <div className="st-section-header">
                                <h3>Active API Keys</h3>
                                <button type="button" className="st-link-btn" onClick={handleAddApiKey} disabled={!canMutate()}>Manage All Keys</button>
                            </div>
                            {apiKeys.length === 0 ? (
                                <p className="st-toggle-desc" style={{ marginTop: 8 }}>No data available</p>
                            ) : apiKeys.map((k) => (
                                <div key={k.id} className="st-api-key-card">
                                    <div className="st-api-key-left">
                                        <div className="st-key-icon"><Key size={18} color="#2badee" /></div>
                                        <div>
                                            <p className="st-key-name">{k.name}</p>
                                            <p className="st-key-val">{k.preview}</p>
                                        </div>
                                    </div>
                                    <div className="st-api-key-right">
                                        <div className="st-key-meta">
                                            <p className="st-key-meta-label">Created</p>
                                            <p className="st-key-meta-val">{k.created_at ? new Date(k.created_at).toLocaleDateString() : "—"}</p>
                                        </div>
                                        <div className="st-key-meta">
                                            <p className="st-key-meta-label">Last Active</p>
                                            <p className="st-key-meta-val">{k.last_used_at && k.last_used_at !== 'Never' ? new Date(k.last_used_at).toLocaleDateString() : "Never"}</p>
                                        </div>
                                        <button type="button" className="st-delete-btn" onClick={() => handleDeleteApiKey(k.id)} aria-label="Delete key" disabled={!canMutate()}><Trash2 size={18} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* AUDIT LOGS */}
                        <div className="st-section" style={{ display: activeSection === "auditlog" ? undefined : "none" }}>
                            <div className="st-section-header">
                                <h3>Enterprise Audit Logs</h3>
                                <button
                                    type="button"
                                    className="st-link-btn"
                                    onClick={handleExportLogs}
                                    disabled={!canMutate() || (filteredAuditLogs.length === 0 && auditLogs.length === 0)}
                                    style={{ display: "flex", alignItems: "center", gap: "6px" }}
                                >
                                    <Download size={16} />
                                    Export
                                </button>
                            </div>

                            {/* Filters */}
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                                gap: "12px",
                                marginBottom: "16px"
                            }}>
                                <div>
                                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Search</label>
                                    <input
                                        type="text"
                                        value={auditSearch}
                                        onChange={(e) => setAuditSearch(e.target.value)}
                                        placeholder="Action, entity, message..."
                                        style={{
                                            width: "100%",
                                            padding: "8px 10px",
                                            background: "var(--bg-input)",
                                            border: "1px solid var(--border)",
                                            borderRadius: "6px",
                                            color: "var(--text)",
                                            fontSize: "12px"
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Action</label>
                                    <select
                                        value={auditActionFilter}
                                        onChange={(e) => setAuditActionFilter(e.target.value)}
                                        style={{
                                            width: "100%",
                                            padding: "8px 10px",
                                            background: "var(--bg-input)",
                                            border: "1px solid var(--border)",
                                            borderRadius: "6px",
                                            color: "var(--text)",
                                            fontSize: "12px"
                                        }}
                                    >
                                        <option value="">All Actions</option>
                                        {auditFilterOptions.actions.map(action => (
                                            <option key={action} value={action}>{action}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Severity</label>
                                    <select
                                        value={auditSeverityFilter}
                                        onChange={(e) => setAuditSeverityFilter(e.target.value)}
                                        style={{
                                            width: "100%",
                                            padding: "8px 10px",
                                            background: "var(--bg-input)",
                                            border: "1px solid var(--border)",
                                            borderRadius: "6px",
                                            color: "var(--text)",
                                            fontSize: "12px"
                                        }}
                                    >
                                        <option value="">All Severities</option>
                                        <option value="INFO">INFO</option>
                                        <option value="WARNING">WARNING</option>
                                        <option value="CRITICAL">CRITICAL</option>
                                        <option value="SECURITY">SECURITY</option>
                                    </select>
                                </div>

                                <div>
                                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>User</label>
                                    <select
                                        value={auditUserFilter}
                                        onChange={(e) => setAuditUserFilter(e.target.value)}
                                        style={{
                                            width: "100%",
                                            padding: "8px 10px",
                                            background: "var(--bg-input)",
                                            border: "1px solid var(--border)",
                                            borderRadius: "6px",
                                            color: "var(--text)",
                                            fontSize: "12px"
                                        }}
                                    >
                                        <option value="">All Users</option>
                                        {auditFilterOptions.users.map(user => (
                                            <option key={user} value={user}>{user}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                                Showing {filteredAuditLogs.length} of {auditLogs.length} logs
                            </p>

                            <div className="st-table-card">
                                <div className="st-table-scroll">
                                    <table className="st-table">
                                        <thead>
                                            <tr>
                                                <th>Action</th>
                                                <th>Severity</th>
                                                <th>User</th>
                                                <th>Entity</th>
                                                <th>Message</th>
                                                <th>IP</th>
                                                <th>Time</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredAuditLogs.length === 0 ? (
                                                <tr className="st-row"><td colSpan={7}><p className="st-toggle-desc">No audit logs found</p></td></tr>
                                            ) : filteredAuditLogs.slice(0, 50).map((row) => (
                                                <tr key={row.id} className="st-row">
                                                    <td style={{ fontSize: "12px", fontWeight: "500" }}>{row.action || "—"}</td>
                                                    <td>
                                                        <span style={{
                                                            fontSize: "11px",
                                                            padding: "4px 8px",
                                                            borderRadius: "4px",
                                                            background: row.severity === "CRITICAL" ? "rgba(255, 71, 87, 0.15)" :
                                                                row.severity === "SECURITY" ? "rgba(255, 193, 7, 0.15)" :
                                                                    row.severity === "WARNING" ? "rgba(255, 152, 0, 0.15)" :
                                                                        "rgba(43, 173, 238, 0.15)",
                                                            color: row.severity === "CRITICAL" ? "#ff4757" :
                                                                row.severity === "SECURITY" ? "#ffc107" :
                                                                    row.severity === "WARNING" ? "#ff9800" :
                                                                        "#2badee"
                                                        }}>
                                                            {row.severity || "INFO"}
                                                        </span>
                                                    </td>
                                                    <td style={{ fontSize: "12px" }}>{row.user || "—"}</td>
                                                    <td style={{ fontSize: "12px" }}>{row.entity || row.entityId || "—"}</td>
                                                    <td style={{ fontSize: "12px", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis" }}>{row.message || "—"}</td>
                                                    <td style={{ fontSize: "12px" }}>{row.ip || "—"}</td>
                                                    <td style={{ fontSize: "12px", whiteSpace: "nowrap" }}>{row.timestamp ? formatTime(row.timestamp) : "—"}</td>
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
            {addUserOpen && (
                <div
                    className="cm-overlay"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setAddUserOpen(false);
                    }}
                >
                    <div className="cm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                        <div className="cm-header">
                            <div>
                                <h2>Add New User</h2>
                                <p className="cm-incident-id">Create a team member record (demo)</p>
                            </div>
                            <button type="button" className="cm-close-btn" onClick={() => setAddUserOpen(false)} aria-label="Close">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="cm-body">
                            <label className="cm-comment-label">Name</label>
                            <input
                                value={newUserName}
                                onChange={(e) => setNewUserName(e.target.value)}
                                placeholder="Full name"
                                style={{ width: "100%", marginBottom: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid #233c48", background: "#0f1720", color: "#e2edf3" }}
                            />
                            <label className="cm-comment-label">Email</label>
                            <input
                                value={newUserEmail}
                                onChange={(e) => setNewUserEmail(e.target.value)}
                                placeholder="user@org.com"
                                style={{ width: "100%", marginBottom: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid #233c48", background: "#0f1720", color: "#e2edf3" }}
                            />
                            <label className="cm-comment-label">Role</label>
                            <select
                                value={newUserRole}
                                onChange={(e) => setNewUserRole(e.target.value)}
                                style={{ width: "100%", marginBottom: 10 }}
                            >
                                <option value="Admin">Admin</option>
                                <option value="Analyst">Analyst</option>
                                <option value="Viewer">Viewer</option>
                            </select>
                            <label className="cm-comment-label">Password</label>
                            <input
                                type="password"
                                value={newUserPassword}
                                onChange={(e) => setNewUserPassword(e.target.value)}
                                placeholder="Min. 6 characters"
                                style={{ width: "100%", marginBottom: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid #233c48", background: "#0f1720", color: "#e2edf3" }}
                            />
                            {addUserError && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 8 }}>{addUserError}</p>}
                        </div>
                        <div className="cm-footer">
                            <button type="button" className="cm-cancel-btn" onClick={() => setAddUserOpen(false)}>
                                Cancel
                            </button>
                            <button type="button" className="cm-confirm-btn" onClick={submitNewUser} disabled={!canMutate()}>
                                Save User
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
