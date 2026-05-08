
# Demo Mode Reset System

## Overview
The system has been configured to support a clean demo mode reset. All changes are in place to reset the application to a fresh state suitable for demonstrations.

## How to Reset to Demo Mode

### Method 1: Browser Console (Easiest)
Open the browser developer console (F12) and run:
```javascript
window.resetToDemo()
```

This will:
1. ✔ Reset all incidents to **OPEN** status
2. ✔ Reset all cases to **TRIAGE** status  
3. ✔ Clear all audit logs
4. ✔ Clear all notifications
5. ✔ Disable auto-escalation
6. ✔ Hide auto-created cases from the Cases page

### Method 2: Programmatic Reset
```javascript
import { resetToDemo } from './platformStore';
resetToDemo();
```

## Changes Made

### 1. **platformStore.js**
- Added `resetToDemo()` function that:
  - Resets all incidents to `status: "open"` with cleared `caseId`, `autoEscalated`, `escalatedByUser`, `classification`, and `closedAt`
  - Resets all cases to `status: "triage"` with cleared `closedAt`
  - Clears audit logs (`LS_AUDIT`, `LS_INCIDENT_AUDIT`)
  - Clears notifications (`LS_NOTIFS`)
  - Emits platform data change event to trigger UI refresh

- Added `window.resetToDemo()` global function for console access

- Updated `createCaseFromIncident()` to mark auto-created cases with `createdManually: false`

### 2. **IncidentPage.jsx**
- **Disabled auto-escalation** (lines 254-303):
  - Commented out the entire auto-escalation effect that triggered when `correlationScore >= 90`
  - Auto-escalation will NOT create cases automatically
  - Users must manually escalate incidents to cases

- **Removed automatic case creation from classification** (lines 385-433):
  - Removed the code block that automatically created cases when incidents were classified
  - Classification now only records the decision without creating cases
  - Users must manually create cases if needed

### 3. **Cases.jsx**
- **Filter out auto-created cases** (line 421):
  - Cases page now filters: `caseList.filter(c => c.createdManually !== false)`
  - Only manually created cases are visible
  - Auto-created cases are hidden from the UI

- **Mark manual case creation** (line 484):
  - When users click "New Case", the case is marked with `createdManually: true`
  - This ensures manually created cases are visible in the Cases page

### 4. **AuditMetrics.jsx**
- Already uses `getIncidents()` for MTTR calculations
- No changes needed - audit metrics correctly use incidents data

## Expected Demo Behavior

After running `window.resetToDemo()`:

| Component | Status |
|-----------|--------|
| All Incidents | OPEN (no escalation) |
| All Cases | TRIAGE (only manually created) |
| Cases Page | Empty (no auto-created cases) |
| Audit Logs | Cleared |
| Notifications | Cleared |
| Auto-Escalation | DISABLED |
| Manual Case Creation | ENABLED |

## Demo Flow

1. **User navigates to Incidents page**
   - All incidents show as OPEN
   - Correlation scores visible but no auto-escalation
   - Users can manually escalate incidents to cases

2. **User clicks "Escalate to Case"**
   - Case is created manually
   - Case appears in Cases page
   - Marked as `createdManually: true`

3. **User navigates to Cases page**
   - Only manually created cases visible
   - No auto-created cases shown
   - Cases start in TRIAGE status

4. **User performs actions**
   - All actions logged in audit trail
   - Notifications appear for user actions
   - Incident status updates tracked

## Testing the Reset

### Verify Reset Worked:
```javascript
// Check incidents are OPEN
console.log(getIncidents().map(i => ({ id: i.id, status: i.status })));

// Check cases are TRIAGE
console.log(getCases().map(c => ({ id: c.id, status: c.status })));

// Check audit logs cleared
console.log(getAuditLog().length); // Should be 0

// Check notifications cleared
console.log(getNotifications().length); // Should be 1 (seed notification)
```

### Verify Auto-Escalation Disabled:
- Navigate to an incident with high correlation score (>90)
- No automatic case creation should occur
- Manual "Escalate to Case" button still works

### Verify Cases Filtering:
- Create a manual case via "New Case" button
- Case appears in Cases page
- Only manually created cases visible

## Rollback

To restore auto-escalation and auto-case-creation:
1. Uncomment the auto-escalation effect in `IncidentPage.jsx` (lines 254-303)
2. Uncomment the auto-case-creation code in `handleClassifyConfirm` (lines 407-415)
3. Remove the filter in `Cases.jsx` (line 421)
4. Rebuild the project

## Files Modified

- `src/platformStore.js` - Added reset function and case creation marking
- `src/pages/IncidentPage.jsx` - Disabled auto-escalation and auto-case-creation
- `src/pages/Cases.jsx` - Added filtering for manually created cases

## Console Commands

```javascript
// Reset to demo mode
window.resetToDemo()

// Get current incidents
getIncidents()

// Get current cases
getCases()

// Get audit log
getAuditLog()

// Get notifications
getNotifications()

// Regenerate incidents from alerts
window.forceRegen()
```

---

**Status**: ✅ Demo mode reset system is ready for use.
