import {
  getCases,
  setCases,
  getAlerts,
  updateStoredAlert,
  pushAudit,
  pushNotification,
  upsertIncident,
} from "../platformStore";
import { getAlerts as getSocAlerts, updateAlert } from "../store/socStore";

/**
 * Comprehensive incident classification workflow.
 * Synchronizes incident → case → alerts with proper audit logging.
 */
export function classifyIncident(incident, classification, analyst, comment = "") {
  if (!incident || !incident.id) {
    throw new Error("Invalid incident: missing id");
  }

  const validClassifications = ["true_positive", "false_positive", "duplicate"];
  if (!validClassifications.includes(classification)) {
    throw new Error(`Invalid classification: ${classification}`);
  }

  const now = new Date().toISOString();
  const incidentId = incident.id;

  // 1. Update incident status
  const updatedIncident = {
    ...incident,
    status: "closed",
    closedAt: now,
    classification,
    resolvedBy: analyst,
    resolvedAt: now,
    reviewStatus: "completed",
    resolution: classification === "false_positive" ? "false_positive" : classification === "duplicate" ? "duplicate" : "resolved",
  };

  // 2. Update all related alerts
  const alertIds = incident.alertIds || [];
  alertIds.forEach((alertId) => {
    updateStoredAlert(alertId, (current) => ({
      ...current,
      status: "resolved",
      falsePositive: classification === "false_positive",
      incidentId,
    }));
  });

  // 3. Update linked case if exists
  const cases = getCases();
  const caseIndex = cases.findIndex((c) => c.incidentId === incidentId);
  let caseResolution = null;

  if (caseIndex >= 0) {
    const linkedCase = cases[caseIndex];
    const resolution =
      classification === "false_positive"
        ? "false_positive"
        : classification === "duplicate"
          ? "duplicate"
          : "true_positive";

    caseResolution = resolution;

    const updatedCase = {
      ...linkedCase,
      status: "closed",
      resolution,
      closedAt: now,
      closedBy: analyst,
    };

    const updatedCases = [...cases];
    updatedCases[caseIndex] = updatedCase;
    setCases(updatedCases);
  }

  // 4. Persist incident update
  upsertIncident(updatedIncident);

  // 5. Create audit log entries
  const auditMessage =
    classification === "false_positive"
      ? `Incident marked as False Positive → Case auto-closed`
      : classification === "duplicate"
        ? `Incident marked as Duplicate → Case auto-closed`
        : `Incident marked as True Positive → Case status updated`;

  pushAudit({
    action: "classification",
    entityType: "incident",
    entityId: incidentId,
    classification,
    analyst,
    message: auditMessage,
    comment: comment || "",
    timestamp: now,
  });

  // 6. Create notifications
  const classificationLabel =
    classification === "true_positive"
      ? "True Positive"
      : classification === "false_positive"
        ? "False Positive"
        : "Duplicate";

  pushNotification(
    `Incident ${incidentId} classified as ${classificationLabel}`,
    { category: "incident" }
  );

  if (caseIndex >= 0) {
    pushNotification(
      `Case linked to ${incidentId} auto-closed (${classificationLabel})`,
      { category: "case" }
    );
  }

  return {
    incident: updatedIncident,
    caseResolution,
    alertsUpdated: alertIds.length,
    auditId: `a-${Date.now()}`,
  };
}

/**
 * Verify incident-case-alert synchronization.
 * Returns validation result with any mismatches found.
 */
export function validateIncidentSync(incidentId) {
  const incidents = [];
  const cases = getCases();
  const alerts = getAlerts();

  const linkedCase = cases.find((c) => c.incidentId === incidentId);
  const relatedAlerts = alerts.filter((a) => a.incidentId === incidentId);

  const issues = [];

  // Check case status matches incident status
  if (linkedCase) {
    if (linkedCase.status !== "closed") {
      issues.push(
        `Case ${linkedCase.id} status is "${linkedCase.status}" but should be "closed"`
      );
    }
    if (!linkedCase.resolution) {
      issues.push(`Case ${linkedCase.id} missing resolution field`);
    }
  }

  // Check all related alerts are resolved
  relatedAlerts.forEach((alert) => {
    if (alert.status !== "resolved") {
      issues.push(
        `Alert ${alert.id} status is "${alert.status}" but should be "resolved"`
      );
    }
  });

  // Check false positive flag is set correctly
  if (linkedCase?.resolution === "false_positive") {
    relatedAlerts.forEach((alert) => {
      if (!alert.falsePositive) {
        issues.push(
          `Alert ${alert.id} missing falsePositive flag for false positive case`
        );
      }
    });
  }

  return {
    incidentId,
    isValid: issues.length === 0,
    issues,
    linkedCase: linkedCase || null,
    alertCount: relatedAlerts.length,
  };
}

/**
 * Get all incidents with their linked cases and related alerts.
 * Useful for debugging sync issues.
 */
export function getIncidentSyncState() {
  const cases = getCases();
  const alerts = getAlerts();

  return cases.map((caseItem) => {
    const relatedAlerts = alerts.filter(
      (a) => a.incidentId === caseItem.incidentId
    );
    return {
      incidentId: caseItem.incidentId,
      caseId: caseItem.id,
      caseStatus: caseItem.status,
      caseResolution: caseItem.resolution,
      alertCount: relatedAlerts.length,
      alertStatuses: relatedAlerts.map((a) => ({
        id: a.id,
        status: a.status,
        falsePositive: a.falsePositive,
      })),
    };
  });
}
