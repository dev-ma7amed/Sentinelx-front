import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from "./client";

// ==========================================
// DASHBOARD STATS
// ==========================================
export async function getDashboardStats() {
    const res = await apiGet("v1/dashboard/stats");
    return res.data || res;
}

// ==========================================
// AUDIT LOGS
// ==========================================
export async function getBackendAuditLogs(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`v1/audit-logs${query ? "?" + query : ""}`);
    return res.data || res;
}

export async function getAuditMetrics(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`v1/audit-logs/metrics${query ? "?" + query : ""}`);
    return res.data || res;
}

// ==========================================
// ALERTS
// ==========================================
export async function getAlertsList(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`v1/alerts${query ? "?" + query : ""}`);
    return res.data || res;
}

export async function getAlertDetail(id) {
    const res = await apiGet(`v1/alerts/${id}`);
    return res.data || res;
}

export async function assignAlert(id, analystId) {
    const res = await apiPatch(`v1/alerts/${id}/assign`, { assigned_to: analystId });
    return res.data || res;
}

export async function investigateAlert(id) {
    const res = await apiPost(`v1/alerts/${id}/investigate`);
    return res.data || res;
}

export async function escalateAlert(id) {
    const res = await apiPost(`v1/alerts/${id}/escalate`);
    return res.data || res;
}

// ==========================================
// DETECTION RULES
// ==========================================
export async function getDetectionRules(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`v1/rules${query ? "?" + query : ""}`);
    return res.data || res;
}

export async function createDetectionRule(ruleData) {
    const res = await apiPost("v1/rules", ruleData);
    return res.data || res;
}

export async function updateDetectionRule(id, ruleData) {
    const res = await apiPut(`v1/rules/${id}`, ruleData);
    return res.data || res;
}

export async function deleteDetectionRule(id) {
    const res = await apiDelete(`v1/rules/${id}`);
    return res.data || res;
}

export async function toggleDetectionRule(id) {
    const res = await apiPatch(`v1/rules/${id}/toggle`, {});
    return res.data || res;
}

// ==========================================
// INTEGRATIONS
// ==========================================
export async function getBackendIntegrations() {
    const res = await apiGet("v1/integrations");
    return res.data || res;
}

export async function updateBackendIntegration(name, integrationData) {
    const res = await apiPatch(`v1/integrations/${name}`, integrationData);
    return res.data || res;
}

// ==========================================
// NOTIFICATIONS
// ==========================================
export async function getBackendNotifications(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`v1/notifications${query ? "?" + query : ""}`);
    return res.data || res;
}

export async function markNotificationRead(id) {
    const res = await apiPatch(`v1/notifications/${id}/read`, {});
    return res.data || res;
}

export async function markAllNotificationsRead() {
    const res = await apiPost("v1/notifications/read-all", {});
    return res.data || res;
}

// ==========================================
// INCIDENTS
// ==========================================
export async function getIncidentsList(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`v1/incidents${query ? "?" + query : ""}`);
    return res.data || res;
}

export async function getIncidentDetail(id) {
    const res = await apiGet(`v1/incidents/${id}`);
    return res.data || res;
}

export async function classifyIncident(id, classification, status) {
    const res = await apiPatch(`v1/incidents/${id}/classify`, { classification, status });
    return res.data || res;
}

// ==========================================
// CASES
// ==========================================
export async function getCasesList(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`v1/cases${query ? "?" + query : ""}`);
    return res.data || res;
}

export async function getCaseDetail(id) {
    const res = await apiGet(`v1/cases/${id}`);
    return res.data || res;
}

export async function createCase(caseData) {
    const res = await apiPost("v1/cases", caseData);
    return res.data || res;
}

export async function addCaseNote(id, text) {
    const res = await apiPost(`v1/cases/${id}/notes`, { text });
    return res.data || res;
}

export async function escalateCase(id, escalationData) {
    const res = await apiPost(`v1/cases/${id}/escalate`, escalationData);
    return res.data || res;
}

export async function closeCase(id, closeData) {
    const res = await apiPost(`v1/cases/${id}/close`, closeData);
    return res.data || res;
}

export async function assignCase(id, assignedTo) {
    const res = await apiPost(`v1/cases/${id}/assign`, { assigned_to: assignedTo });
    return res.data || res;
}

// ==========================================
// MITRE ENGAGEMENT
// ==========================================
export async function getMitreMapping(alertId) {
    const res = await apiGet(`v1/intelligence/mitre/${alertId}`);
    return res.data || res;
}

// ==========================================
// USERS (ADMINS)
// ==========================================
export async function getUsersList() {
    const res = await apiGet("v1/users");
    return res.data || res;
}

export async function createUser(userData) {
    const res = await apiPost("v1/users", userData);
    return res.data || res;
}

export async function getUserDetail(id) {
    const res = await apiGet(`v1/users/${id}`);
    return res.data || res;
}

export async function updateUser(id, userData) {
    const res = await apiPut(`v1/users/${id}`, userData);
    return res.data || res;
}

export async function deleteUser(id) {
    const res = await apiDelete(`v1/users/${id}`);
    return res.data || res;
}

export async function toggleUserStatus(id) {
    const res = await apiPost(`v1/users/${id}/toggle-status`);
    return res.data || res;
}

// ==========================================
// AUDIT LOGS
// ==========================================
export async function getAuditLogsList(params) {
    const res = await apiGet("v1/audit-logs", params);
    return res.data || res;
}

// ==========================================
// SETTINGS
// ==========================================
export async function getSettingsList() {
    const res = await apiGet("v1/settings");
    return res.data || res;
}

export async function updateSetting(key, value) {
    const res = await apiPut(`v1/settings/${key}`, { value });
    return res.data || res;
}

// ==========================================
// API KEYS
// ==========================================
export async function getApiKeysList() {
    const res = await apiGet("v1/api-keys");
    return res.data || res;
}

export async function createApiKey(data) {
    const res = await apiPost("v1/api-keys", data);
    return res.data || res;
}

export async function deleteApiKey(id) {
    const res = await apiDelete(`v1/api-keys/${id}`);
    return res.data || res;
}
