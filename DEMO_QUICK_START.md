# DEMO MODE QUICK START

## Reset System to Demo State
```javascript
window.resetToDemo()
```

## What Gets Reset
✔ All incidents → OPEN status  
✔ All cases → TRIAGE status  
✔ Audit logs → Cleared  
✔ Notifications → Cleared  
✔ Auto-escalation → DISABLED  
✔ Cases page → Shows only manually created cases  

## Demo Workflow

### 1. View Incidents (All OPEN)
- Navigate to `/incidents`
- All incidents show OPEN status
- Correlation scores visible
- No automatic case creation

### 2. Manually Escalate Incident
- Click "Escalate to Case" button
- Case is created and linked
- Case appears in Cases page

### 3. View Cases (Only Manual)
- Navigate to `/cases`
- Only manually created cases visible
- Auto-created cases hidden
- All cases in TRIAGE status

### 4. Perform Case Actions
- Assign, escalate, close cases
- All actions logged in audit trail
- Notifications appear for actions

## Useful Console Commands

```javascript
// Reset to demo
window.resetToDemo()

// View all incidents
getIncidents()

// View all cases
getCases()

// View audit log
getAuditLog()

// View notifications
getNotifications()

// Regenerate incidents from alerts
window.forceRegen()
```

## Key Changes

| File | Change |
|------|--------|
| `platformStore.js` | Added `window.resetToDemo()` function |
| `IncidentPage.jsx` | Disabled auto-escalation (commented out) |
| `IncidentPage.jsx` | Removed auto-case-creation from classify |
| `Cases.jsx` | Filter to show only manually created cases |
| `Cases.jsx` | Mark new cases as `createdManually: true` |

## Expected Results After Reset

```
Incidents Page:
- All incidents: OPEN
- No auto-escalation
- Manual escalation works

Cases Page:
- Empty (no auto-created cases)
- "New Case" button creates manual cases
- Manual cases appear immediately

Audit Page:
- No audit logs
- Fresh start for demo

Notifications:
- Only seed notification
- User actions create new notifications
```

---

**Ready for demo!** Run `window.resetToDemo()` in browser console to start.
