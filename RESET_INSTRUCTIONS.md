# SentinelX Demo Mode Reset & Sync Instructions

## Problem
If the UI shows out-of-sync data (incidents/cases/dashboard not matching), the state needs to be synchronized.

## Solution

### Option 1: Sync Incidents to Cases (Recommended)

1. Open the app in your browser: http://127.0.0.1:9000
2. Open Developer Tools (F12 or Ctrl+Shift+I)
3. Go to the Console tab
4. Run this command:

```javascript
window.syncIncidentCaseData()
```

5. Press Enter
6. Refresh the page (F5)

Expected output:
```
🔄 SYNCING INCIDENT/CASE DATA...
✔ Created case: CR-xxx for incident: INC-xxx
✅ SYNC COMPLETE - Incidents linked to cases, all statuses synchronized
```

### Option 2: Full Reset

If sync doesn't work, do a full reset:

1. Open Developer Tools (F12)
2. Go to Console tab
3. Run:

```javascript
window.resetToDemo()
```

4. Press Enter
5. Refresh the page (F5)

Expected output:
```
🔄 RESETTING SYSTEM TO DEMO MODE...
✔ Incidents reset to OPEN with auto-escalation flags
✔ Cases reset to TRIAGE/OPEN
✔ Alerts reset to OPEN
✔ Audit logs cleared
✔ Notifications cleared
✅ DEMO MODE READY - All incidents OPEN, cases TRIAGE, auto-escalation enabled for critical
```

### Option 3: Clear localStorage Manually

1. Open Developer Tools (F12)
2. Go to Application → Local Storage
3. Find your domain (127.0.0.1:9000)
4. Delete these keys:
   - soc_incidents
   - soc_cases
   - soc_alerts
   - soc_audit_log
   - soc_incident_audit
   - soc_notifications

5. Refresh the page

### Option 4: Hard Reset (Nuclear Option)

1. Open Developer Tools (F12)
2. Go to Application → Local Storage
3. Right-click and "Clear All"
4. Refresh the page

## Expected Result After Sync/Reset

### Incident Page
- Status: OPEN — AUTO ESCALATED (for critical incidents)
- Button: "Already Escalated"
- Alerts: ACTIVE/OPEN

### Case Page
- Phase: TRIAGE
- Status: OPEN
- Appears in sidebar
- Linked to incident

### Dashboard
- Open Cases: 1+ (if critical incidents exist)
- Alerts: Active count

## What Gets Synced

✅ Critical incidents → linked to cases
✅ All incidents → status: "open"
✅ All cases → status: "open", phase: "Triage"
✅ All alerts → status: "open"
✅ Auto-escalation flags → enabled for critical incidents
✅ Incident ↔ Case linking → synchronized

## What Gets Reset (Full Reset Only)

✅ All incidents → status: "open"
✅ All cases → status: "open", phase: "Triage"
✅ All alerts → status: "open"
✅ Auto-escalation flags → enabled for critical incidents
✅ Audit logs → cleared
✅ Notifications → cleared

## What Stays the Same

✅ Business logic (auto-escalation, case linking)
✅ Incident correlation
✅ Threat intelligence
✅ Role-based access
✅ All workflows

## Troubleshooting

If sync/reset doesn't work:
1. Make sure you're logged in
2. Check browser console for errors
3. Try Option 4 (Hard Reset)
4. Restart the dev server: `npm run dev`

## For Developers

To trigger operations programmatically:
```javascript
// Sync incidents to cases
window.syncIncidentCaseData()

// Full reset to demo mode
window.resetToDemo()

// Regenerate incidents from alerts
window.forceRegen()
```

## Expected Workflow

```
CRITICAL INCIDENT (score >= 90)
    ↓
AUTO ESCALATION ENABLED
    ↓
CASE CREATED (TRIAGE/OPEN)
    ↓
INCIDENT REMAINS OPEN
    ↓
BUTTON: "Already Escalated"
    ↓
DASHBOARD: Open Cases = 1
    ↓
ANALYST INVESTIGATES
    ↓
ANALYST DECIDES:
  • True Positive → Close → RESOLVED
  • False Positive → Mark FP → RESOLVED
```
