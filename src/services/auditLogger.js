import { getCurrentUser } from "../session";

const LS_AUDIT_LOGS = "audit_logs";

// Action name constants - Enterprise naming format
export const AUDIT_ACTIONS = {
    // Authentication
    LOGIN_SUCCESS: "LOGIN_SUCCESS",
    LOGIN_FAILURE: "LOGIN_FAILURE",
    MFA_SUCCESS: "MFA_SUCCESS",
    MFA_FAILURE: "MFA_FAILURE",
    LOGOUT: "LOGOUT",

    // Case Management
    CASE_CREATED: "CASE_CREATED",
    CASE_ASSIGNED: "CASE_ASSIGNED",
    CASE_ESCALATED: "CASE_ESCALATED",
    CASE_CLOSED: "CASE_CLOSED",
    CASE_REOPENED: "CASE_REOPENED",
    CASE_ARCHIVED: "CASE_ARCHIVED",

    // Incident Management
    INCIDENT_CREATED: "INCIDENT_CREATED",
    INCIDENT_ASSIGNED: "INCIDENT_ASSIGNED",
    INCIDENT_ESCALATED: "INCIDENT_ESCALATED",
    INCIDENT_CLASSIFIED: "INCIDENT_CLASSIFIED",
    INCIDENT_CLOSED: "INCIDENT_CLOSED",

    // Security Events
    MALICIOUS_IOC_DETECTED: "MALICIOUS_IOC_DETECTED",
    UNAUTHORIZED_IP_BLOCKED: "UNAUTHORIZED_IP_BLOCKED",
    SECURITY_SETTING_CHANGED: "SECURITY_SETTING_CHANGED",

    // Settings & Configuration
    SETTINGS_UPDATED: "SETTINGS_UPDATED",
    API_ACCESS_CHANGED: "API_ACCESS_CHANGED",
    WHITELIST_UPDATED: "WHITELIST_UPDATED",
    USER_CREATED: "USER_CREATED",
    USER_DELETED: "USER_DELETED",
    USER_ROLE_CHANGED: "USER_ROLE_CHANGED",

    // System
    SYSTEM_REFRESH: "SYSTEM_REFRESH",
    EXPORT_INITIATED: "EXPORT_INITIATED",
};

// Severity levels
export const AUDIT_SEVERITY = {
    INFO: "INFO",
    WARNING: "WARNING",
    CRITICAL: "CRITICAL",
    SECURITY: "SECURITY",
};

// Get current user IP (mock for frontend)
function getCurrentUserIp() {
    try {
        return localStorage.getItem("user_ip") || "127.0.0.1";
    } catch {
        return "127.0.0.1";
    }
}

// Get all audit logs
export function getAuditLogs() {
    try {
        const raw = localStorage.getItem(LS_AUDIT_LOGS);
        if (raw) {
            const logs = JSON.parse(raw);
            if (Array.isArray(logs)) return logs;
        }
    } catch (e) {
        console.error("Error reading audit logs:", e);
    }
    return [];
}

// Add a new audit log entry
export function addAuditLog(log) {
    try {
        if (!log || typeof log !== "object") {
            console.warn("Invalid audit log entry:", log);
            return null;
        }

        const user = getCurrentUser();
        const entry = {
            id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            action: log.action || "UNKNOWN",
            severity: log.severity || AUDIT_SEVERITY.INFO,
            user: log.user || user?.name || "System",
            ip: log.ip || getCurrentUserIp(),
            entity: log.entity || null,
            entityId: log.entityId || null,
            caseId: log.caseId || null,
            incidentId: log.incidentId || null,
            message: log.message || "",
            details: log.details || null,
            status: log.status || "success",
        };

        const logs = getAuditLogs();
        logs.unshift(entry);

        // Keep only last 1000 logs
        const trimmed = logs.slice(0, 1000);

        localStorage.setItem(LS_AUDIT_LOGS, JSON.stringify(trimmed));

        // Trigger realtime refresh
        if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("soc_system_refresh"));
            window.dispatchEvent(new Event("soc_audit_update"));
        }

        return entry;
    } catch (e) {
        console.error("Error adding audit log:", e);
        return null;
    }
}

// Clear all audit logs (admin only)
export function clearAuditLogs() {
    try {
        localStorage.removeItem(LS_AUDIT_LOGS);
        if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("soc_system_refresh"));
        }
        return true;
    } catch (e) {
        console.error("Error clearing audit logs:", e);
        return false;
    }
}

// Export audit logs as JSON
export function exportAuditLogs() {
    try {
        const logs = getAuditLogs();
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return true;
    } catch (e) {
        console.error("Error exporting audit logs:", e);
        return false;
    }
}

// Get logs filtered by criteria
export function filterAuditLogs(criteria = {}) {
    let logs = getAuditLogs();

    if (criteria.action) {
        logs = logs.filter(l => l.action === criteria.action);
    }

    if (criteria.severity) {
        logs = logs.filter(l => l.severity === criteria.severity);
    }

    if (criteria.user) {
        logs = logs.filter(l => l.user?.toLowerCase().includes(criteria.user.toLowerCase()));
    }

    if (criteria.search) {
        const q = criteria.search.toLowerCase();
        logs = logs.filter(l =>
            l.action.toLowerCase().includes(q) ||
            l.entity?.toLowerCase().includes(q) ||
            l.message?.toLowerCase().includes(q) ||
            l.user?.toLowerCase().includes(q)
        );
    }

    if (criteria.caseId) {
        logs = logs.filter(l => l.caseId === criteria.caseId);
    }

    if (criteria.incidentId) {
        logs = logs.filter(l => l.incidentId === criteria.incidentId);
    }

    if (criteria.startDate) {
        const start = new Date(criteria.startDate).getTime();
        logs = logs.filter(l => new Date(l.timestamp).getTime() >= start);
    }

    if (criteria.endDate) {
        const end = new Date(criteria.endDate).getTime();
        logs = logs.filter(l => new Date(l.timestamp).getTime() <= end);
    }

    return logs;
}

// Get unique values for filter dropdowns
export function getAuditFilterOptions() {
    const logs = getAuditLogs();

    const actions = [...new Set(logs.map(l => l.action))].sort();
    const severities = [...new Set(logs.map(l => l.severity))].sort();
    const users = [...new Set(logs.map(l => l.user))].sort();

    return { actions, severities, users };
}
