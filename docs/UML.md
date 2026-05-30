# UML Architecture & Sequence Diagrams

This document contains visual UML diagrams mapping out the classes, lifecycles, and asynchronous processing sequence of **SentinelX**. The diagrams are formatted using Mermaid JS syntax for native markdown rendering.

---

## 1. Class Diagram
Maps the relationships, fields, and operations of controllers, models, and service classes within the backend logic layer.

```mermaid
classDiagram
    direction TB
    
    class WebhookController {
        +receiveAlert(Request request) Response
    }
    
    class ProcessAlertJob {
        -array rawPayload
        +handle() void
    }
    
    class RuleEngine {
        +getRules() Collection
        +applyRules(Alert alert, Collection allAlerts) Alert
    }
    
    class CorrelationEngine {
        +correlate(Alert alert) Incident
        +calculateRiskScore(Collection alerts) int
    }
    
    class ThreatIntelService {
        -string vtApiKey
        -string cacheTTL
        +enrichIP(string ip) ThreatIntelPayload
        -lookupVirusTotal(string ip) array
        -lookupAbuseIPDB(string ip) array
    }
    
    class Alert {
        +string id
        +string incidentId
        +string correlationId
        +string severity
        +string srcIP
        +string status
        +save() bool
        +markInProgress() void
        +resolve(bool isFalsePositive) void
    }
    
    class Incident {
        +string id
        +string caseId
        +string srcIP
        +int correlationScore
        +string status
        +upsert() Incident
        +classify(string type) void
    }
    
    class Case {
        +string id
        +string incidentId
        +string severity
        +string status
        +addNote(string text) Note
        +escalate(string level) void
        +close(string classification) void
    }

    WebhookController ..> ProcessAlertJob : dispatches
    ProcessAlertJob --> RuleEngine : uses
    ProcessAlertJob --> CorrelationEngine : uses
    ProcessAlertJob --> ThreatIntelService : dispatches enrichment
    CorrelationEngine --> Alert : updates/groups
    CorrelationEngine --> Incident : generates/mutates
    CorrelationEngine --> Case : auto-creates
    Incident "1" -- "0..1" Case : escalated_into
    Alert "*" -- "0..1" Incident : contains
```

---

## 2. Webhook Telemetry Processing Sequence Diagram
Traces the execution path from an external sensor webhook request through the database write, background worker queues, threat intelligence enrichments, and final real-time UI notification updates.

```mermaid
sequenceDiagram
    autonumber
    actor Sensor as External Sensor (Wazuh/Suricata)
    participant Web as Webhook Intake API
    participant Queue as Redis Queue
    participant Worker as Background Queue Worker
    participant DB as Relational Database
    participant Intel as Threat Intel Service (APIs)
    participant WS as WebSocket Broker (Reverb/Pusher)
    actor Client as Analyst Dashboard UI
    
    Sensor->>Web: HTTP POST /api/v1/webhooks/alerts (raw JSON)
    activate Web
    Web->>DB: Save raw stage dump (fail-safe log)
    Web->>Queue: Push "ProcessAlertJob" payload
    Web-->>Sensor: 202 Accepted (Latency < 20ms)
    deactivate Web
    
    activate Queue
    Queue->>Worker: Dequeue Job
    deactivate Queue
    activate Worker
    
    Worker->>Worker: Rule Engine: Normalization & Regex Match
    Worker->>DB: Insert Normalized Alert Record
    
    Worker->>DB: Query existing alerts for src_ip (5-min sliding window)
    DB-->>Worker: Return array of match records
    
    Worker->>Worker: Correlation Engine: Recalculate Risk Score
    Worker->>DB: Upsert Incident Container (status: open/needs-review)
    
    alt Correlation Risk Score >= 90 (or Critical alert)
        Worker->>Worker: Auto-Escalate: Spawn Case Record
        Worker->>DB: Insert Case Ticket (status: triage)
        Worker->>DB: Update Incident table (auto_case_created = true)
    end
    
    Worker->>Intel: Dispatch Async Enrichment Job (IP Address)
    activate Intel
    Intel->>Intel: Check cache first (Redis cache)
    alt Cache Miss
        Intel->>Intel: Perform concurrent HTTP requests to VirusTotal / AbuseIPDB
        Intel->>Intel: Populate cache with 5-minute TTL
    end
    Intel->>DB: Save Aggregated Intel Report to DB
    deactivate Intel
    
    Worker->>WS: Broadcast "SentinelXDataChanged" Event
    activate WS
    WS-->>Client: WebSocket Notification (State Mutation push)
    deactivate WS
    
    deactivate Worker
```

---

## 3. Incident & Case Status State Machines
Outlines the logic flow and transitions governing state mutations. The backend must enforce that no terminal state (e.g., Closed) can transition backwards without strict privilege checks.

### 3.1 Incident State Transition Lifecycle
```mermaid
stateDiagram-v2
    [*] --> Open : Webhook Alert Received
    Open --> NeedsReview : Correlation Risk Score < 90
    Open --> AutoEscalated : Correlation Risk Score >= 90
    
    NeedsReview --> Escalated : Analyst Clicks "Escalate to Case"
    AutoEscalated --> Escalated : Automated Case Generated
    
    NeedsReview --> Closed : Classify as "False Positive" / "Duplicate"
    Escalated --> Closed : Linked Case is Closed/Resolved
    
    Closed --> [*]
```

### 3.2 Case State Transition Lifecycle
```mermaid
stateDiagram-v2
    [*] --> Triage : Incident Escalated
    Triage --> Investigating : Analyst Assessed (Assign Owner)
    Investigating --> Escalated : Elevated to higher tier (L2/L3)
    
    Triage --> Closed : Resolved (Closed as False Positive)
    Investigating --> Closed : Containment Verified (Resolved as True Positive)
    Escalated --> Closed : Remediation Completed
    
    Closed --> [*]
```
