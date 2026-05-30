# SentinelX - Security Operations Center (SOC) Documentation Index

Welcome to the backend architecture and system analysis documentation for **SentinelX**, an enterprise-grade Security Operations Center (SOC) platform. 

This documentation package has been prepared specifically to serve as a comprehensive blueprint for developing a robust, high-performance, secure backend (e.g., PHP/Laravel) that replaces the current simulated client-side logic with a real production database, webhook intake pipeline, and third-party threat intelligence integrations.

## Documentation Structure

The system analysis is divided into dedicated files to cover every aspect of the project lifecycle, architecture, and schema details:

| Document | File Path | Description |
| :--- | :--- | :--- |
| **Product Requirements Document (PRD)** | [PRD.md](./PRD.md) | Details the core product vision, user roles and permissions, alert lifecycle, and external integration requirements. |
| **Technical Requirements Document (TRD)** | [TRD.md](./TRD.md) | Defines the backend architecture, REST API endpoint specs, webhook processing pipelines, scoring/correlation algorithms, and threat intelligence logic. |
| **Entity Relationship Diagram (ERD)** | [ERD.md](./ERD.md) | Outlines the relational database schema, database types, primary/foreign keys, and indexes required for fast alert intake. |
| **UML Diagrams** | [UML.md](./UML.md) | Contains visual models (Mermaid JS format) including Class Diagrams, State Machine Diagrams, and Webhook Data Ingestion Sequence Diagrams. |
| **Backend Implementation Spec** | [BACKEND_SPEC.md](./BACKEND_SPEC.md) | Provides highly granular technical blueprints for webhook ingestion scaling, specific data fields to index, Laravel-specific implementation guidelines, and testing. |

---

## The SentinelX Core Architecture
At its core, SentinelX operates on a three-tier hierarchical intelligence pipeline designed to filter raw security telemetry and group it into actionable security investigations:

```
[ Raw Webhook Events ]
      ↓  (Wazuh, Suricata, Sysmon, Network ML)
  1. ALERTS Ingested & Normalized
      ↓  (Grouped by Source IP)
  2. INCIDENTS Correlated & Scored
      ↓  (Score >= 90 or Critical Escalation)
  3. CASES Managed & Escaped (Triage -> Resolution)
```

By transitioning this logic to the backend, you will enable:
1. **High Ingestion Throughput**: Ability to process thousands of alerts per second using asynchronous queues.
2. **True Role Enforcement**: Absolute server-side validation of administrative, analyst, and viewer actions.
3. **Real Threat Intelligence**: Real-time integration with VirusTotal, AbuseIPDB, and automated MITRE ATT&CK technique mapping.
4. **Permanent Audit Trails**: Immutable server-side logging of all analyst actions and containment decisions.
