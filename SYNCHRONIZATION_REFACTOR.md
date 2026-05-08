# Cases + Audit Synchronization Refactor

## Overview
Refactored the entire Cases + Audit synchronization layer to establish a single source of truth in `platformStore.js`. This eliminates desynchronized state across metrics, case sidebar, audit tables, filters, and resolutions.

## Problem Solved
- **Before**: Metrics, case sidebar, audit tables, filters, and resolutions used different sources of truth
- **After**: All state derives from centralized `platformStore` functions

## Key Changes

### 1. Unified Action Handler (`executeUnifiedAction`)
Created a centralized action dispatcher in `platformStore.js` that handles all state mutations:

```javascript
executeUnifiedAction(action, payload)
```

Supported actions:
- `classify_incident` - Classify incident, update case, sync alerts, create audit log
- `close_case` - Close case, sync incident, create audit log
- `assign_case` - Assign case to analyst, create audit log
- `escalate_case` - Escalate case to level, create audit log
- `archive_case` - Archive case, create audit log

**Key Feature**: Each action automatically:
- Updates incident/case/alerts
- Creates audit log entry
- Pushes notification
- Emits platform data change event
- Maintains referential integrity

### 2. Centralized Metrics Calculation (`calculateMetrics`)
Replaced all hardcoded and placeholder metrics with real calculations:

```javascript
calculateMetrics() → {
  falsePositiveRate,      // false_positive / resolved
  detectionEfficacy,      // true_positive / investigated
  mttr,                   // average(resolvedAt - createdAt)
  analystActions,         // action counts per analyst
  openCases,
  pendingReview,
  archivedCases,
  totalCases,
  totalIncidents,
  resolvedIncidents,
  resolvedCases
}
```

**No more static values** - all metrics derive from real store data.

### 3. Updated Components

#### Cases.jsx
- `handleClassifyConfirm()` → uses `executeUnifiedAction("close_case")`
- `handleAssignSubmit()` → uses `executeUnifiedAction("assign_case")`
- `handleEscalateSubmit()` → uses `executeUnifiedAction("escalate_case")`
- Removed duplicate audit logging (now handled by unified action)
- Removed duplicate state updates (now handled by unified action)

#### IncidentPage.jsx
- `handleClassifyConfirm()` → uses `executeUnifiedAction("classify_incident")`
- Removed duplicate audit logging
- Removed duplicate state updates

#### AuditMetrics.jsx
- `displayStats` → uses centralized `calculateMetrics()`
- Removed local `calculateMetrics()` function (duplicate)
- All metrics now derive from store data
- Removed hardcoded placeholder values

### 4. Data Flow

```
User Action (classify, assign, escalate, etc.)
    ↓
executeUnifiedAction(action, payload)
    ↓
Update incident/case/alerts in store
    ↓
Create audit log entry
    ↓
Push notification
    ↓
Emit soc_platform_data event
    ↓
Components re-render from store data
    ↓
Metrics recalculate from store
```

## Synchronization Guarantees

### Incident Classification
When incident is classified:
1. Incident status → "closed"
2. Incident resolution → classification type
3. Related alerts → "resolved" + falsePositive flag
4. Linked case → "closed" + resolution
5. Audit log → created with classification
6. Notification → pushed
7. All UI components → re-render from store

### Case Closure
When case is closed:
1. Case status → "closed"
2. Case resolution → classification
3. Linked incident → "closed" + classification
4. Audit log → created
5. Notification → pushed
6. Metrics → recalculate

### Case Assignment
When case is assigned:
1. Case assignedTo → analyst name
2. Audit log → created
3. Notification → pushed
4. Sidebar filters → update

## Removed Duplications

- ❌ Removed duplicate `calculateMetrics()` from AuditMetrics.jsx
- ❌ Removed duplicate audit logging from Cases.jsx
- ❌ Removed duplicate state updates from Cases.jsx
- ❌ Removed duplicate audit logging from IncidentPage.jsx
- ❌ Removed hardcoded metric values
- ❌ Removed placeholder arrays

## Testing Checklist

- [x] Build succeeds
- [x] No duplicate function declarations
- [x] Unified action handler exports correctly
- [x] Cases.jsx uses unified actions
- [x] IncidentPage.jsx uses unified actions
- [x] AuditMetrics.jsx uses centralized metrics
- [x] All imports resolve correctly

## Future Improvements

1. Add transaction support for multi-entity updates
2. Add rollback capability for failed actions
3. Add action history/replay for debugging
4. Add real-time sync across browser tabs
5. Add offline queue for actions
