# SentinelX - SOC Platform Business Logic

This document outlines the core business logic, automated workflows, and data processing rules implemented in the SentinelX SOC (Security Operations Center) platform.

---

## 1. Data Hierarchy
The system operates on a three-tier data hierarchy:
1.  **Alerts**: Individual security events from various sources (Wazuh, Suricata, Sysmon, Network ML).
2.  **Incidents**: Aggregated and correlated alerts grouped by a common attribute (Source IP).
3.  **Cases**: Escalated incidents that require formal investigation and tracking.

---

## 2. Alert Normalization & Scoring
Every incoming alert is assigned a weight based on its severity to facilitate risk calculation.

| Severity | Weight |
| :--- | :--- |
| Critical | 40 |
| High | 30 |
| Medium | 20 |
| Low | 10 |

---

## 3. Incident Correlation Logic
The "Correlator" engine groups raw alerts into meaningful incidents to reduce alert fatigue for analysts.

*   **Grouping Strategy**: Alerts are grouped by `srcIP` (Source IP address).
*   **Correlation Score Formula**:
    The system calculates a risk score (0-100) using the following algorithm:
    1.  **Base Score**: Sum of all alert weights in the group.
    2.  **Diversity Bonus**: `+ (Number of Unique Sources * 10)`.
    3.  **Volume Bonus**: `+ (Number of Alerts * 2)`.
    4.  **Advanced Attack Bonus**:
        *   `+15` if the incident spans 3 or more unique security sources.
        *   `+15` if the incident covers 3 or more MITRE ATT&CK stages.
    5.  **Cap**: The final score is capped at **100**.

---

## 4. Escalation Workflow
SentinelX uses a hybrid escalation model (Automated + Manual).

### 4.1 Auto-Escalation (High Risk)
*   **Trigger**: Correlation Score **≥ 90**.
*   **Action**: The system automatically changes the incident status to `auto-escalated` and creates a **Case** record.
*   **Notification**: A system-wide security notification is triggered, and an audit log is created.

### 4.2 Manual Escalation (Low/Medium Risk)
*   **Trigger**: Correlation Score **< 90**.
*   **Status**: Marked as `needs-review`.
*   **Action**: Analysts must manually review the incident timeline and evidence. They can then click "Escalate to Case" to start a formal investigation.

---

## 5. Case Management
Once an incident becomes a case, it enters the management lifecycle:
*   **Triage**: Initial state of a new case.
*   **Assignment**: Cases can be assigned to specific SOC analysts.
*   **Actions**: Analysts can add notes, change priority, or link additional evidence.
*   **Resolution**: Cases are eventually marked as `Closed` or `Resolved`.

---

## 6. Authentication & Security (Simulated)
*   **MFA (Multi-Factor Authentication)**: All logins require a 6-digit OTP. 
*   **Demo Logic**: For development/demo purposes, the OTP is logged to the browser console and system notifications rather than being sent via email.
*   **Session Persistence**: User sessions and roles (Admin, Analyst, Viewer) are managed via `localStorage`.

---

## 7. Persistence Layer
Since this is a frontend-centric application:
*   **Browser Storage**: All data (Incidents, Cases, Audit Logs, Notifications) is persisted in the browser's `localStorage`.
*   **Initialization**: On first load, the system "re-hydrates" the state from storage or generates fresh mock data if storage is empty.
*   **Reset**: A `window.resetToDemo()` function is available to clear all modifications and return the system to its initial "Demo Ready" state.

---

## 8. Audit & Compliance
Every "Mutation" (state change) in the platform triggers:
1.  **Audit Log Entry**: A permanent record of *who* did *what* and *when*.
2.  **Live Notification**: A real-time UI alert for active analysts.
