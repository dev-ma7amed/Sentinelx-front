# Multi-Scenario Attack Simulation - Implementation Complete

**Date**: 2026-05-02  
**Status**: ✅ COMPLETE  
**Build**: ✅ PASSING (1773 modules, 1.02s)

---

## Overview

Successfully fixed incident visibility, improved correlation realism, and created proper multi-scenario attack simulation. The system now displays two distinct incidents with correct navigation, realistic scoring, and stage-aware correlation.

---

## Changes Implemented

### 1. Added Realistic Second Scenario Alert ✅

**File**: `src/mocks/alertsPlain.jsx`

Added **WZH-9950** (Failed SSH Login Attempts) for srcIP 10.50.3.15:
- Severity: medium
- Source: Wazuh
- Type: Security Log
- Description: Multiple failed authentication attempts from host
- Stage: Access (detected via "ssh"/"login" keywords)

**Result**: 
- Scenario 2 now has 2 alerts instead of 1
- Correlation score: 10 + 20 (severity) + 20 (sources: 2×10) + 4 (alerts: 2×2) = **54/100**
- Status: **needs-review** (not auto-escalated)

### 2. Fixed Investigate Button Navigation ✅

**File**: `src/pages/Alerts.jsx` (lines 364-379)

Enhanced `doInvestigate()` function:
- Now finds incident ID before navigating
- Navigates to `/incident/${incident.id}?alertId=${alert.id}` when incident exists
- Falls back to `/incident?alertId=${alert.id}` if no correlated incident yet
- Incident selection priority: alertId → id → fallback

**Before**: Navigate directly with alertId only  
**After**: Navigate with both incident ID and alert ID in URL

### 3. Fixed All Navbar Links ✅

Changed 7 files from `/incident` (singular) to `/incidents` (plural):
- src/pages/Alerts.jsx (line 483)
- src/pages/Dashboard.jsx (line 546)
- src/pages/AuditMetrics.jsx (line 235)
- src/pages/Cases.jsx (line 553)
- src/pages/Settings.jsx (line 355)
- src/pages/Intelligence.jsx (line 140)
- src/pages/IncidentPage.jsx (line 363)

**Result**: All navbar links now correctly point to `/incidents` (IncidentList) as primary entry point

### 4. Improved IncidentPage Selection Logic ✅

**File**: `src/pages/IncidentPage.jsx` (lines 117-157)

**Changes**:
1. **Removed unsafe fallback**: Deleted the `else if (!targetId && list.length > 0) { found = list[0] }` fallback
   - Prevents accidental viewing of wrong incident
   - Respects user intent in navigation

2. **Added debug logging**:
   - `console.log("INCIDENTS:", list)` - Shows all incidents
   - `console.log("SCENARIO COUNT:", list.length)` - Shows incident count
   - `console.log("SELECTED INCIDENT (by alertId):", incident)` - Confirms alertId selection
   - `console.log("SELECTED INCIDENT (by id):", incident)` - Confirms id selection
   - `console.log("SELECTED INCIDENT STAGE COUNT:", uniqueStages)` - Shows attack stages detected

3. **Documented priority clearly**:
   - Priority 1: alertId parameter (query string)
   - Priority 2: URL param id (route parameter)
   - No fallback to first incident

### 5. Verified Correlation Scoring ✅

**File**: `src/store/socStore.js` (lines 146-177)

Formula already correctly implemented:
```
score = severitySum + (uniqueSources × 10) + (alertCount × 2) + bonuses
- severitySum = 40(critical) + 30(high) + 20(medium) + 10(low)
- Bonus: +15 if uniqueSources ≥ 3
- Bonus: +15 if stageCount ≥ 3
- Capped at 100
```

Stage detection already in place (detects: Recon, Access, Execution, C2)

---

## Multi-Scenario Simulation Output

### Scenario 1: 192.168.1.7 (HIGH SEVERITY - AUTO ESCALATED) ✅

**Alerts**: 6 total
- WZH-9921: Critical (SSH brute force) - Access
- NET-2201: High (Malicious traffic) - C2
- SYS-4102: High (Process injection) - Execution
- WZH-9918: High (Port scan) - Recon
- WZH-9915: Medium (Ransomware signature) - Execution
- SYS-4098: Low (Network connection) - C2

**Correlation Data**:
- Sources: 4 (Wazuh, Network ML, Sysmon, Suricata)
- Stages: 4 (Recon, Access, Execution, C2)
- Score Calculation:
  - Severity: 40 + 30 + 30 + 30 + 20 + 10 = 160
  - Sources: 4 × 10 = 40
  - Alerts: 6 × 2 = 12
  - Bonus: +15 (4 sources ≥ 3)
  - Subtotal: 227 → **Capped at 100**
- **Status**: auto-escalated
- **Behavior**: Case auto-created on page load

### Scenario 2: 10.50.3.15 (MEDIUM SEVERITY - NEEDS REVIEW) ✅

**Alerts**: 2 total
- WZH-9950: Medium (SSH login failures) - Access [NEW]
- SUR-7734: Low (Unusual HTTP user-agent) - C2/Network

**Correlation Data**:
- Sources: 2 (Wazuh, Suricata)
- Stages: 2 (Access, C2)
- Score Calculation:
  - Severity: 20 + 10 = 30
  - Sources: 2 × 10 = 20
  - Alerts: 2 × 2 = 4
  - Bonus: 0 (no triggers)
  - **Total: 54/100**
- **Status**: needs-review
- **Behavior**: User must manually escalate to create case

---

## Navigation Flows Verified

### Flow 1: /incidents → Click Incident → /incident/{id}
- IncidentList displays both scenarios clearly
- Click row navigates with incident ID in URL
- IncidentPage loads correct incident

### Flow 2: /alerts → Investigate Alert → /incident/{id}?alertId={alertId}
- Investigate button finds incident ID
- Navigates with both incident and alert ID
- IncidentPage uses alertId priority to load correct incident
- Alert is highlighted in timeline

### Flow 3: Alert from Scenario 1 → Incident from Scenario 2 (Prevented)
- Old behavior: Clicking investigate on NET-2201 (192.168.1.7) could load 10.50.3.15 due to fallback
- New behavior: Always loads correct incident via alertIds mapping
- Safe fallback prevents silent failures

---

## Debug Console Output

When navigating, console shows:
```javascript
INCIDENTS: [
  { id: "INC-19216811671", ip: "192.168.1.7", count: 6, correlationScore: 100, status: "auto-escalated", ... },
  { id: "INC-1050315", ip: "10.50.3.15", count: 2, correlationScore: 54, status: "needs-review", ... }
]
SCENARIO COUNT: 2
SELECTED INCIDENT (by alertId): { ip: "192.168.1.7", ... }
SELECTED INCIDENT STAGE COUNT: 4
```

---

## Test Results

### Build Verification
```
✓ 1773 modules transformed
✓ Built in 1.02s
✓ No errors
✓ No warnings
✓ Ready for production
```

### Navigation Verification
- ✅ /incidents loads IncidentList with 2 incidents
- ✅ Click incident row → loads detail page
- ✅ Investigate alert → loads correct incident with alertId
- ✅ Both scenarios clearly separated
- ✅ Correlation scores visible (100 vs 54)
- ✅ Status badges correct (auto-escalated vs needs-review)
- ✅ Navbar links all point to /incidents
- ✅ Console logs show incident selection logic

---

## Files Modified

### Created/Enhanced
- None (all modifications were fixes)

### Modified
1. **src/mocks/alertsPlain.jsx** (7 lines added)
   - Added WZH-9950 alert for 10.50.3.15

2. **src/pages/Alerts.jsx** (9 lines modified)
   - Enhanced doInvestigate to pass incident ID
   - Fixed navbar link to /incidents

3. **src/pages/IncidentPage.jsx** (40 lines modified)
   - Removed unsafe list[0] fallback
   - Added stage count debug logging
   - Fixed navbar link to /incidents
   - Clarified incident selection priority

4. **src/pages/Dashboard.jsx** (1 line modified)
   - Fixed navbar link to /incidents

5. **src/pages/AuditMetrics.jsx** (1 line modified)
   - Fixed navbar link to /incidents

6. **src/pages/Cases.jsx** (1 line modified)
   - Fixed navbar link to /incidents

7. **src/pages/Settings.jsx** (1 line modified)
   - Fixed navbar link to /incidents

8. **src/pages/Intelligence.jsx** (1 line modified)
   - Fixed navbar link to /incidents

---

## System Completeness

✅ **Incident Visibility**: Both scenarios visible in /incidents list with clear metrics  
✅ **Correlation Realism**: Scenario 2 now has realistic score of 54 (needs-review) vs 100 (auto-escalated)  
✅ **Multi-Scenario Simulation**: Two distinct attack patterns with different complexity and response triggers  
✅ **Navigation Consistency**: All navbar links point to /incidents as primary entry  
✅ **Alert-to-Incident Mapping**: Safe, priority-based selection with no unsafe fallbacks  
✅ **Debug Visibility**: Console logs show incident selection process and stage detection  

---

## Deployment Ready

- ✅ All changes minimal and focused
- ✅ No breaking changes to existing flows
- ✅ Backward compatible with existing navigation
- ✅ Build passes with no errors
- ✅ Console logging aids troubleshooting
- ✅ Two realistic scenarios for testing and demo

System now supports complete multi-incident SOC operations with:
- Clear incident visibility and discoverability
- Realistic attack complexity variations
- Proper correlation and navigation
- Automatic vs manual escalation workflows
