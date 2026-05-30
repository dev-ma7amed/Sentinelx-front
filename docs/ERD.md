# Entity Relationship Diagram (ERD) & Database Schema Spec

This document details the database schema, datatypes, relational links, and indexing structures required to implement the **SentinelX** backend. The design is optimized for high-throughput webhook intake, fast group correlation queries, and rigorous audit tracking.

---

## 1. Relational Database Model
This is a standard entity relationship visualization modeled for PostgreSQL / MySQL.

```mermaid
erDiagram
    USERS ||--o{ AUDIT_LOGS : performs
    USERS ||--o{ CASE_NOTES : writes
    
    ALERTS }o--o| INCIDENTS : correlated_into
    INCIDENTS ||--o| CASES : escalated_to
    
    CASES ||--o{ CASE_NOTES : contains
    CASES ||--o{ TIMELINE_EVENTS : contains
    
    INCIDENTS ||--o{ INCIDENT_AUDIT_LOGS : tracks
    
    USERS {
        bigint id PK
        string name
        string email UK
        string password_hash
        string role "Administrator, SOC Analyst, Viewer"
        string otp_secret
        timestamp otp_expires_at
        timestamp created_at
    }

    ALERTS {
        string id PK "e.g., NET-2201, WZH-9921"
        string incident_id FK "nullable"
        string correlation_id "index"
        string severity "low, medium, high, critical"
        string raw_severity
        string source "Wazuh, Sysmon, Suricata, Network ML"
        string type "Security Log, Host Behavior, etc."
        string description
        string sub_description
        string src_ip "index"
        string dst_ip
        string hostname
        string username
        string status "new, in-progress, resolved"
        jsonb raw_payload
        boolean false_positive
        string assigned_to "nullable"
        timestamp created_at "index"
        timestamp updated_at
    }

    INCIDENTS {
        string id PK "INC-stablehash"
        string case_id FK "nullable"
        string src_ip UK "index"
        string severity "low, medium, high, critical"
        integer correlation_score
        integer risk_score
        integer alert_count
        string status "open, resolved, closed"
        string review_status "review, completed"
        string type "Attack category string"
        string classification "nullable"
        string resolution "nullable"
        string resolved_by "nullable"
        boolean auto_escalated
        boolean auto_case_created
        timestamp closed_at
        timestamp created_at "index"
        timestamp updated_at
    }

    CASES {
        string id PK "CR-timestamp"
        string incident_id FK UK
        string title
        string description
        string severity "low, medium, high, critical"
        string priority "low, medium, high, critical"
        string status "triage, in-progress, closed"
        string resolution "false_positive, duplicate, true_positive"
        string assigned_to "nullable"
        string opened_by
        string closed_by "nullable"
        integer confidence
        integer correlation_score
        string affected_machine_hostname
        string affected_machine_ip
        boolean archived
        boolean pending
        boolean created_manually
        timestamp closed_at
        timestamp created_at "index"
        timestamp updated_at
    }

    CASE_NOTES {
        bigint id PK
        string case_id FK
        bigint user_id FK
        string text
        timestamp created_at
    }

    TIMELINE_EVENTS {
        bigint id PK
        string case_id FK
        string type "primary, secondary"
        string title
        string text
        timestamp created_at
    }

    AUDIT_LOGS {
        bigint id PK
        bigint user_id FK "nullable (System)"
        string action "login, classification, close_case, etc."
        string entity_type "alert, incident, case, user"
        string entity_id
        string message
        jsonb details
        timestamp created_at
    }

    INCIDENT_AUDIT_LOGS {
        bigint id PK
        string incident_id FK
        string type "e.g., ASSIGN, CONTAINMENT"
        string message
        timestamp created_at
    }
```

---

## 2. Table Schemas & Data Types

### 2.1 `users`
Persists analyst profiles, credentials, and OTP metadata.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | BigInt | Primary Key, Auto-Increment | Unique identifier. |
| `name` | String(255) | Not Null | Display name. |
| `email` | String(255) | Unique, Not Null | Credentials email. |
| `password_hash` | String(255) | Not Null | Hashed password (Bcrypt). |
| `role` | Enum | Not Null | `['Administrator', 'SOC Analyst', 'Viewer']`. |
| `otp_secret` | String(255) | Nullable | Temp OTP for MFA verification. |
| `otp_expires_at`| Timestamp | Nullable | Time restriction on OTP validation. |
| `created_at` | Timestamp | Not Null | Record creation timestamp. |

### 2.2 `alerts`
Stores Normalized Telemetry. Ingested from sensors.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | String(100) | Primary Key | Custom generated sensor ID (e.g., NET-2201). |
| `incident_id` | String(100) | Nullable, Foreign Key | Links to `incidents.id`. |
| `correlation_id`| String(100) | Not Null | Groups matching alerts (e.g., corr-192-168-1-7). |
| `severity` | Enum | Not Null | `['low', 'medium', 'high', 'critical']`. |
| `raw_severity` | String(50) | Not Null | Value parsed directly from sensor before rules. |
| `source` | String(100) | Not Null | Wazuh, Suricata, Sysmon, Network ML. |
| `type` | String(255) | Not Null | Security classification (e.g., Process Injection). |
| `description` | Text | Not Null | Main alert summary text. |
| `sub_description`| Text | Nullable | Secondary metadata text. |
| `src_ip` | String(45) | Not Null | Threat agent source IP address (IPv4/IPv6). |
| `dst_ip` | String(45) | Nullable | Destination target IP address. |
| `hostname` | String(255) | Nullable | Target device hostname. |
| `username` | String(255) | Nullable | Target user account execution context. |
| `status` | Enum | Default: `'new'` | `['new', 'in-progress', 'resolved']`. |
| `raw_payload` | JSONB | Nullable | Original unparsed JSON packet (for debugging). |
| `false_positive`| Boolean | Default: `false` | Set to true if closed during FP classification. |
| `assigned_to` | String(255) | Nullable | Display name of assigned analyst. |
| `created_at` | Timestamp | Not Null | Webhook ingestion timestamp. |

### 2.3 `incidents`
Correlated clusters of IP alerts.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | String(100) | Primary Key | Generated as `INC-{stablehash(src_ip)}`. |
| `case_id` | String(100) | Nullable | Linked case identifier (if escalated). |
| `src_ip` | String(45) | Unique, Not Null | Correlated Source IP address. |
| `severity` | Enum | Not Null | Highest severity score among active alert child records. |
| `correlation_score`| Integer | Not Null | Score (0-100) computed by the rule correlator. |
| `risk_score` | Integer | Not Null | Risk score (0-100) factoring volume and stages. |
| `status` | Enum | Default: `'open'` | `['open', 'resolved', 'closed']`. |
| `auto_escalated` | Boolean | Default: `false` | True if correlation score was $\ge 90$ at creation. |
| `auto_case_created`| Boolean | Default: `false` | Prevent multiple automated cases from generating. |
| `created_at` | Timestamp | Not Null | Timestamp of first alert matching this IP. |

### 2.4 `cases`
Escalated Incident Tickets for active analyst workflow tracking.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | String(100) | Primary Key | Custom generated (e.g., CR-169992019). |
| `incident_id` | String(100) | Unique, Foreign Key | Links directly to `incidents.id`. |
| `title` | String(255) | Not Null | Header description (defaults to Incident Type). |
| `status` | Enum | Default: `'triage'`| `['triage', 'in-progress', 'closed']`. |
| `priority` | Enum | Not Null | `['low', 'medium', 'high', 'critical']`. |
| `assigned_to` | String(255) | Nullable | Name of active investigator. |
| `confidence` | Integer | Not Null | Calculated investigative confidence. |

---

## 3. Database Indexes Optimization Spec
Webhook intake endpoints are subject to write-heavy operations. The indexing strategy must prioritize fast alert inserts and high-performance correlation grouping queries without bottlenecking:

1.  **Alerts Table Indexes**:
    *   `CREATE INDEX idx_alerts_src_ip ON alerts(src_ip);`
        *   *Rationale*: Accelerates correlation search checks triggered on every webhook hit.
    *   `CREATE INDEX idx_alerts_correlation_id ON alerts(correlation_id);`
        *   *Rationale*: Speeds up bulk status updates (e.g., marking correlated alerts as `in-progress`).
    *   `CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);`
        *   *Rationale*: Speeds up recent telemetry dashboard grids and polling updates.
2.  **Incidents Table Indexes**:
    *   `CREATE UNIQUE INDEX idx_incidents_src_ip ON incidents(src_ip);`
        *   *Rationale*: Guarantees single active incident container per IP for correlation mapping.
3.  **Audit Logs Table Indexes**:
    *   `CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);`
        *   *Rationale*: Optimizes history retrieval for specific incidents and cases pages.
