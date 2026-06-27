import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock localStorage before importing platformStore (which executes forceStorageReset on load)
let localStorageStore = {};
global.localStorage = {
  getItem: vi.fn((key) => localStorageStore[key] || null),
  setItem: vi.fn((key, value) => { localStorageStore[key] = String(value); }),
  removeItem: vi.fn((key) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { localStorageStore = {}; }),
  length: 0,
  key: vi.fn((index) => Object.keys(localStorageStore)[index] || null),
};

const {
  classifyIncident,
  validateIncidentSync,
  getIncidentSyncState,
} = await import("../utils/incidentWorkflow");

const {
  forceResetAlerts,
  forceResetCases,
  forceResetIncidents,
  getAlerts,
  getCases,
  setCases,
  getAuditLog,
  getNotifications,
  upsertIncident,
  updateStoredAlert,
} = await import("../platformStore");

describe("Incident Classification Workflow", () => {
  beforeEach(() => {
    forceResetAlerts();
    forceResetCases();
    forceResetIncidents();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("classifyIncident", () => {
    it("should throw error for invalid incident", () => {
      expect(() => classifyIncident(null, "true_positive", "analyst")).toThrow(
        "Invalid incident: missing id"
      );
      expect(() =>
        classifyIncident({}, "true_positive", "analyst")
      ).toThrow("Invalid incident: missing id");
    });

    it("should throw error for invalid classification", () => {
      const incident = { id: "INC-001", alertIds: [] };
      expect(() =>
        classifyIncident(incident, "invalid", "analyst")
      ).toThrow("Invalid classification: invalid");
    });

    it("should close incident on true positive classification", () => {
      const incident = {
        id: "INC-001",
        status: "open",
        alertIds: ["alert-1"],
      };

      upsertIncident(incident);
      const result = classifyIncident(
        incident,
        "true_positive",
        "analyst@soc.com"
      );

      expect(result.incident.status).toBe("closed");
      expect(result.incident.classification).toBe("true_positive");
      expect(result.incident.resolvedBy).toBe("analyst@soc.com");
      expect(result.incident.closedAt).toBeDefined();
    });

    it("should close incident on false positive classification", () => {
      const incident = {
        id: "INC-002",
        status: "open",
        alertIds: ["alert-2"],
      };

      upsertIncident(incident);
      const result = classifyIncident(
        incident,
        "false_positive",
        "analyst@soc.com"
      );

      expect(result.incident.status).toBe("closed");
      expect(result.incident.classification).toBe("false_positive");
    });

    it("should mark all related alerts as resolved", () => {
      const alertIds = ["alert-1", "alert-2", "alert-3"];
      const incident = {
        id: "INC-003",
        status: "open",
        alertIds,
      };

      alertIds.forEach((id) => {
        updateStoredAlert(id, { id, status: "new", incidentId: "INC-003" });
      });

      upsertIncident(incident);
      classifyIncident(incident, "true_positive", "analyst");

      const alerts = getAlerts();
      alertIds.forEach((id) => {
        const alert = alerts.find((a) => a.id === id);
        expect(alert.status).toBe("resolved");
      });
    });

    it("should set falsePositive flag on alerts for false positive classification", () => {
      const alertIds = ["alert-1", "alert-2"];
      const incident = {
        id: "INC-004",
        status: "open",
        alertIds,
      };

      alertIds.forEach((id) => {
        updateStoredAlert(id, { id, status: "new", incidentId: "INC-004" });
      });

      upsertIncident(incident);
      classifyIncident(incident, "false_positive", "analyst");

      const alerts = getAlerts();
      alertIds.forEach((id) => {
        const alert = alerts.find((a) => a.id === id);
        expect(alert.falsePositive).toBe(true);
      });
    });

    it("should NOT set falsePositive flag for true positive classification", () => {
      const alertIds = ["alert-1"];
      const incident = {
        id: "INC-005",
        status: "open",
        alertIds,
      };

      alertIds.forEach((id) => {
        updateStoredAlert(id, { id, status: "new", incidentId: "INC-005" });
      });

      upsertIncident(incident);
      classifyIncident(incident, "true_positive", "analyst");

      const alerts = getAlerts();
      const alert = alerts.find((a) => a.id === "alert-1");
      expect(alert.falsePositive).not.toBe(true);
    });

    it("should create audit log entry with proper message", () => {
      const incident = {
        id: "INC-006",
        status: "open",
        alertIds: [],
      };

      upsertIncident(incident);
      classifyIncident(incident, "false_positive", "analyst", "Test comment");

      const auditLog = getAuditLog();
      const entry = auditLog.find((a) => a.entityId === "INC-006");

      expect(entry).toBeDefined();
      expect(entry.action).toBe("classification");
      expect(entry.classification).toBe("false_positive");
      expect(entry.message).toContain("False Positive");
      expect(entry.message).toContain("Case auto-closed");
      expect(entry.comment).toBe("Test comment");
    });

    it("should create notifications for classification", () => {
      const incident = {
        id: "INC-007",
        status: "open",
        alertIds: [],
      };

      upsertIncident(incident);
      classifyIncident(incident, "true_positive", "analyst");

      const notifications = getNotifications();
      const classificationNotif = notifications.find((n) =>
        n.text.includes("INC-007")
      );

      expect(classificationNotif).toBeDefined();
      expect(classificationNotif.text).toContain("True Positive");
    });

    it("should return correct result object", () => {
      const incident = {
        id: "INC-008",
        status: "open",
        alertIds: ["alert-1", "alert-2"],
      };

      updateStoredAlert("alert-1", { id: "alert-1", status: "new" });
      updateStoredAlert("alert-2", { id: "alert-2", status: "new" });
      upsertIncident(incident);

      const result = classifyIncident(incident, "true_positive", "analyst");

      expect(result).toHaveProperty("incident");
      expect(result).toHaveProperty("caseResolution");
      expect(result).toHaveProperty("alertsUpdated");
      expect(result).toHaveProperty("auditId");
      expect(result.alertsUpdated).toBe(2);
    });
  });

  describe("validateIncidentSync", () => {
    it("should validate incident with no issues", () => {
      const incident = {
        id: "INC-009",
        status: "closed",
        alertIds: ["alert-1"],
      };

      updateStoredAlert("alert-1", {
        id: "alert-1",
        status: "resolved",
        incidentId: "INC-009",
      });
      upsertIncident(incident);

      const validation = validateIncidentSync("INC-009");

      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it("should detect unresolved alerts", () => {
      const incident = {
        id: "INC-010",
        status: "closed",
        alertIds: ["alert-1"],
      };

      updateStoredAlert("alert-1", {
        id: "alert-1",
        status: "new",
        incidentId: "INC-010",
      });
      upsertIncident(incident);

      const validation = validateIncidentSync("INC-010");

      expect(validation.isValid).toBe(false);
      expect(validation.issues.some((i) => i.includes("status"))).toBe(true);
    });

    it("should detect missing falsePositive flag", () => {
      const incident = {
        id: "INC-011",
        status: "closed",
        alertIds: ["alert-1"],
      };

      updateStoredAlert("alert-1", {
        id: "alert-1",
        status: "resolved",
        incidentId: "INC-011",
        falsePositive: false,
      });
      setCases([
        {
          id: "case-11",
          incidentId: "INC-011",
          status: "closed",
          resolution: "false_positive",
        }
      ]);
      upsertIncident(incident);

      const validation = validateIncidentSync("INC-011");

      expect(validation.isValid).toBe(false);
      expect(
        validation.issues.some((i) => i.includes("falsePositive"))
      ).toBe(true);
    });

    it("should return correct validation structure", () => {
      const incident = {
        id: "INC-012",
        status: "closed",
        alertIds: [],
      };

      upsertIncident(incident);
      const validation = validateIncidentSync("INC-012");

      expect(validation).toHaveProperty("incidentId");
      expect(validation).toHaveProperty("isValid");
      expect(validation).toHaveProperty("issues");
      expect(validation).toHaveProperty("linkedCase");
      expect(validation).toHaveProperty("alertCount");
    });
  });

  describe("getIncidentSyncState", () => {
    it("should return empty array when no cases exist", () => {
      const state = getIncidentSyncState();
      expect(Array.isArray(state)).toBe(true);
      expect(state).toHaveLength(0);
    });

    it("should return sync state for all incidents", () => {
      const incident1 = {
        id: "INC-013",
        status: "closed",
        alertIds: ["alert-1"],
      };
      const incident2 = {
        id: "INC-014",
        status: "closed",
        alertIds: ["alert-2", "alert-3"],
      };

      updateStoredAlert("alert-1", {
        id: "alert-1",
        status: "resolved",
        incidentId: "INC-013",
      });
      updateStoredAlert("alert-2", {
        id: "alert-2",
        status: "resolved",
        incidentId: "INC-014",
      });
      updateStoredAlert("alert-3", {
        id: "alert-3",
        status: "resolved",
        incidentId: "INC-014",
      });

      upsertIncident(incident1);
      upsertIncident(incident2);
      setCases([
        {
          id: "case-13",
          incidentId: "INC-013",
          status: "closed",
          resolution: "true_positive",
        },
        {
          id: "case-14",
          incidentId: "INC-014",
          status: "closed",
          resolution: "true_positive",
        }
      ]);

      const state = getIncidentSyncState();

      expect(Array.isArray(state)).toBe(true);
      expect(state.length).toBeGreaterThan(0);
      state.forEach((item) => {
        expect(item).toHaveProperty("incidentId");
        expect(item).toHaveProperty("caseId");
        expect(item).toHaveProperty("alertCount");
        expect(item).toHaveProperty("alertStatuses");
      });
    });
  });

  describe("End-to-end workflow", () => {
    it("should complete full false positive workflow", () => {
      const alertIds = ["alert-1", "alert-2"];
      const incident = {
        id: "INC-015",
        status: "open",
        alertIds,
      };

      alertIds.forEach((id) => {
        updateStoredAlert(id, {
          id,
          status: "new",
          incidentId: "INC-015",
        });
      });

      upsertIncident(incident);

      const result = classifyIncident(
        incident,
        "false_positive",
        "analyst",
        "Legitimate traffic"
      );

      expect(result.incident.status).toBe("closed");
      expect(result.incident.classification).toBe("false_positive");

      const alerts = getAlerts();
      alertIds.forEach((id) => {
        const alert = alerts.find((a) => a.id === id);
        expect(alert.status).toBe("resolved");
        expect(alert.falsePositive).toBe(true);
      });

      const auditLog = getAuditLog();
      const auditEntry = auditLog.find((a) => a.entityId === "INC-015");
      expect(auditEntry.message).toContain("False Positive");
      expect(auditEntry.message).toContain("Case auto-closed");
    });

    it("should complete full true positive workflow", () => {
      const alertIds = ["alert-3"];
      const incident = {
        id: "INC-016",
        status: "open",
        alertIds,
      };

      updateStoredAlert("alert-3", {
        id: "alert-3",
        status: "new",
        incidentId: "INC-016",
      });

      upsertIncident(incident);

      const result = classifyIncident(
        incident,
        "true_positive",
        "analyst",
        "Confirmed attack"
      );

      expect(result.incident.status).toBe("closed");
      expect(result.incident.classification).toBe("true_positive");

      const alerts = getAlerts();
      const alert = alerts.find((a) => a.id === "alert-3");
      expect(alert.status).toBe("resolved");

      const auditLog = getAuditLog();
      const auditEntry = auditLog.find((a) => a.entityId === "INC-016");
      expect(auditEntry.classification).toBe("true_positive");
    });
  });
});
