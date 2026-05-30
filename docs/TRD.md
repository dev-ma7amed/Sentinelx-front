# Technical Requirements Document (TRD)

## 1. System Architecture & Tech Stack
To translate the current client-side simulated state into a scalable enterprise architecture, the backend will leverage a robust high-performance web framework. Given the developer environment configurations, the blueprint below outlines a **PHP / Laravel** implementation stack, though the design principles remain framework-agnostic.

```
                  ┌──────────────────────────────────────────────┐
                  │          EXTERNAL SECURITY SENSORS           │
                  │   (Wazuh, Suricata, Sysmon, Network ML)     │
                  └──────────────────────┬───────────────────────┘
                                         │  Webhook HTTP POST
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │            LARAVEL WEBHOOK ENGINE            │
                  │   • Request Validation                       │
                  │   • Quick database staging (Alert Ingestion) │
                  └──────────────────────┬───────────────────────┘
                                         │  Dispatches job asynchronously
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │             REDIS WORKER QUEUE               │
                  │  Job: ProcessAlertCorrelation                │
                  └──────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
  ┌──────────────────────────────┐                ┌──────────────────────────────┐
  │       CORRELATION ENGINE      │                │   INTELLIGENCE ENRICHMENT    │
  │ • Applies Rules Engine       │                │ • VirusTotal Lookup          │
  │ • Groups alerts by srcIP     │                │ • AbuseIPDB Lookup           │
  │ • Calculates Correlation Risk│                │ • Redis Intel Cache (5 min)  │
  └──────────────┬───────────────┘                └──────────────┬───────────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │             RELATIONAL DATABASE              │
                  │         (MySQL / PostgreSQL / SQLite)        │
                  └──────────────────────┬───────────────────────┘
                                         │  Triggers event
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │              WEBSOCKET SERVER                │
                  │       (Pusher / Laravel Reverb / Echo)       │
                  └──────────────────────┬───────────────────────┘
                                         │  Broadcasts mutation in real-time
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │             SENTINELX REACT UI               │
                  │        (Real-time State Rehydration)         │
                  └──────────────────────────────────────────────┘
```

### 1.1 Architectural Component Matrix
*   **Web Framework**: Laravel 11.x (PHP 8.2+) providing fast routing, robust ORM, and integrated event broadcasting.
*   **Database**: PostgreSQL or MySQL. Relational storage is ideal to handle the strong relational hierarchy between `Alerts ──► Incidents ──► Cases ──► Notes`.
*   **Queue Server**: Redis. Used to stage incoming alerts off the main request thread, preventing webhook timeouts.
*   **Caching Layer**: Redis (with a 5-minute TTL cache for VirusTotal/AbuseIPDB IP lookups).
*   **Real-time Push**: Laravel Reverb or Pusher (WebSockets) to broadcast new alerts, incident creations, and case modifications directly to the active analyst dashboard.

---

## 2. Ingestion & Webhook Intake Pipeline
Webhooks from tools like Wazuh or Suricata can trigger massive burst traffic during brute-force or port-scanning events. The webhook intake pipeline must be designed for **ultra-low latency ingestion**:

1.  **Ingestion Request (`POST /api/v1/webhooks/alerts`)**:
    *   The intake controller accepts the payload, performs basic signature verification (if API key or webhook secret is configured), saves the raw JSON to the database, and immediately returns a `202 Accepted` status code.
    *   **No heavy calculations or third-party queries are performed during the HTTP request lifecycle.**
2.  **Job Dispatching**:
    *   An asynchronous queue job `ProcessAlertCorrelation` is dispatched to Redis.
3.  **Queue Execution**:
    *   The background worker executes the job:
        *   **Normalization**: Standardizes severity level, timestamps, and matches rules.
        *   **Rule Engine**: Compares alert parameters with active system rules (stored in the database). Upgrades severities or appends rule match names.
        *   **Correlation Engine**: Groups the normalized alert with other alerts matching the same `srcIP` within the sliding temporal threshold (5 minutes).
        *   **Risk Scoring**: Recalculates the incident correlation score.
        *   **Auto-Escalation**: If the calculated score is $\ge 90$ or a `critical` event is flagged, it spawns a `Case` automatically.
        *   **Enrichment dispatch**: Triggers non-blocking background workers to gather IP intelligence data.
        *   **Broadcast**: Dispatches a WebSocket event (`SentinelXDataChanged`) to notify all active browser clients.

---

## 3. Core Algorithms & Logic Specs

### 3.1 Scoring & Correlation Mathematics
The incident correlation engine groups raw alerts by `srcIP` (Source IP address) and computes a **Correlation Risk Score** between 0 and 100 using the following formula:

$$\text{Base Score} = \sum_{a \in \text{Incident Alerts}} \text{Severity Weight}(a)$$

| Severity | Weight |
| :--- | :--- |
| **Critical** | 40 |
| **High** | 25 |
| **Medium** | 15 |
| **Low** | 5 |

#### 3.2 Score Adjustments & Bonuses:
1.  **Diversity Bonus**: $+ (\text{Number of Unique Sources} \times 5)$
    *   Sources = Wazuh, Suricata, Sysmon, Network ML.
2.  **Volume Bonus**: $+ (\text{Number of Incident Alerts} \times 3)$
3.  **Cross-Coverage Bonus**: $+6$
    *   Triggered if the incident alerts span both **Host-based sources** (Wazuh or Sysmon) AND **Network-based sources** (Suricata or Network ML).
4.  **Critical Threshold Override**:
    *   If the incident contains at least one alert with a severity of `critical`, the score is automatically boosted to a minimum of **92** ($\max(\text{Risk Score}, 92)$).
    *   If no critical alerts are present, the score is capped at **85** ($\min(\text{Risk Score}, 85)$) unless it triggers the auto-escalation rule.
5.  **Hard Cap**: The final score is always capped at **100**.

> [!TIP]
> **Auto-Escalation Trigger**: When the Correlation Risk Score reaches or exceeds **90** (or a critical severity is flagged), the incident status must be set to `auto-escalated` and a `Case` record must be created automatically. The field `autoCaseCreated` is flagged to `true` to ensure the system does not repeatedly create cases for the same incident during subsequent alert matches.

---

## 4. REST API Endpoint Specifications

All endpoints require standard header prefixes: `Accept: application/json` and `Authorization: Bearer <JWT_TOKEN>`.

### 4.1 Authentication & OTP Endpoints
*   `POST /api/v1/auth/login`
    *   *Payload*: `{ "email": "analyst@sentinelx.io", "password": "SecurePassword123!" }`
    *   *Response*: `200 OK` -> `{ "message": "OTP sent to registered email.", "session_id": "sess_89f..." }` (OTP is generated and sent via SMTP; in dev environments, it can be returned in JSON or logged).
*   `POST /api/v1/auth/verify-otp`
    *   *Payload*: `{ "email": "analyst@sentinelx.io", "otp": "123456", "session_id": "sess_89f..." }`
    *   *Response*: `200 OK` -> `{ "token": "jwt_ey...", "user": { "id": 2, "name": "SOC Analyst", "role": "SOC Analyst" } }`

### 4.2 Alerts API
*   `GET /api/v1/alerts`
    *   Returns Paginated list. Filters: `status` (new, in-progress, resolved), `severity`, `source`, `srcIP`.
*   `PATCH /api/v1/alerts/{id}/assign`
    *   *Payload*: `{ "assignedTo": "Alex Wright" }`
    *   Changes alert status to `in-progress` if it was `new`. Logs audit trace.
*   `POST /api/v1/alerts/{id}/investigate`
    *   Finds the alert's `correlationId`. Updates all alerts matching this `correlationId` to status `in-progress` (bulk triage workflow).

### 4.3 Incidents API
*   `GET /api/v1/incidents`
    *   Returns a list of all correlated IP groups, counts, current risk scores, statuses, and stages.
*   `GET /api/v1/incidents/{id}`
    *   Returns detailed telemetry including child alerts list, timeline records, and target details.
*   `PATCH /api/v1/incidents/{id}/classify`
    *   *Payload*: `{ "classification": "true_positive" | "false_positive" | "duplicate", "comment": "Analyst comment" }`
    *   Sets incident status to `closed`, updates linked alerts status to `resolved` (setting `falsePositive` boolean on alerts if marked false positive), updates linked case status to `closed`, and triggers audit trail logging.

### 4.4 Cases API
*   `GET /api/v1/cases`
    *   Retrieves active cases.
*   `POST /api/v1/cases`
    *   *Payload*: `{ "incidentId": "INC-19216817" }` (Manual escalation).
    *   Creates a case, links the incident, flags it manually escalated, and generates timeline stages.
*   `POST /api/v1/cases/{id}/notes`
    *   *Payload*: `{ "text": "Isolating infected host process..." }`
    *   Appends investigator findings.
*   `POST /api/v1/cases/{id}/escalate`
    *   *Payload*: `{ "level": "L2 Analyst Group", "reason": "Severe process injection detected" }`
    *   Changes case status to `escalated`, flags it pending.
*   `POST /api/v1/cases/{id}/close`
    *   *Payload*: `{ "classification": "true_positive", "comment": "Containment verified" }`
    *   Closes the case, closes the linked incident, resolves all child alerts.

### 4.5 Threat Intelligence & Telemetry API
*   `GET /api/v1/intelligence/enrich/{ip}`
    *   Returns threat assessment for requested IP.
    *   If private IP (RFC 1918): returns threat score `0` and flags `isPrivate: true` with internal local details.
    *   If public IP: performs VirusTotal and AbuseIPDB API checks. Cache hits are read from Redis; cache misses initiate external HTTP requests, populate Redis with a 5-minute TTL, and return the aggregated data payload.
