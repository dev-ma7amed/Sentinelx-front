# Auto Case Integration Testing Scenarios

## Overview
The system now implements automated case creation based on correlation scoring. Two distinct testing scenarios validate the implementation.

## Scoring Formula (Unchanged)
```
score = (sum_of_severity_weights) + (unique_sources * 10) + (alert_count * 2)
capped at 100

Severity Weights:
- critical: 40
- high: 30
- medium: 20
- low: 10
```

---

## Scenario 1: HIGH SCORE → AUTO ESCALATION (Score ≥ 90)

### Source Incident IP: 192.168.1.7

#### Alerts in this incident:
1. **WZH-9921** (Wazuh)
   - Severity: critical
   - Weight: 40
   - Description: Multiple Failed SSH Logins

2. **NET-2201** (Network ML)
   - Severity: high
   - Weight: 30
   - Description: Malicious Traffic Pattern

3. **SYS-4102** (Sysmon)
   - Severity: high
   - Weight: 30
   - Description: Process Injection Detected

4. **WZH-9918** (Suricata)
   - Severity: high
   - Weight: 30
   - Description: Port Scan Detected

5. **WZH-9915** (Wazuh)
   - Severity: medium
   - Weight: 20
   - Description: Ransomware Signature Match

6. **SYS-4098** (Sysmon)
   - Severity: low
   - Weight: 10
   - Description: Network Connection Initiated

#### Score Calculation:
```
Severity Sum:    40 + 30 + 30 + 30 + 20 + 10 = 160
Unique Sources:  Wazuh, Network ML, Sysmon, Suricata = 4 sources × 10 = 40
Alert Count:     6 alerts × 2 = 12
Total:           160 + 40 + 12 = 212 → capped at 100
```

**Expected Result: Score = 100/100**

#### User Flow:
1. Navigate to `/incident`
2. First incident (IP: 192.168.1.7) loads
3. See badge: "AUTO ESCALATED (100/100)" in red
4. Case automatically created
5. Automatically redirected to `/cases` with the new case
6. Case shows linked incident: **INC-19216811671** (clickable)
7. Can click incident link to navigate back to `/incident`

#### Verification:
- ✓ Correlation score displayed correctly (100/100)
- ✓ Status shows "Auto-Escalated"
- ✓ "Already Escalated" button disabled
- ✓ Case created automatically without user action
- ✓ Auto audit entry: "Auto-escalated with score 100/100"
- ✓ Navigation flow: Incident → Case → Incident works

---

## Scenario 2: LOW SCORE → ANALYST REVIEW (Score < 90)

### Source Incident IP: 10.50.3.15 (NEW)

#### Alert in this incident:
1. **SUR-7734** (Suricata) — *Added for testing*
   - Severity: low
   - Weight: 10
   - Description: Unusual HTTP User-Agent
   - srcIP: 10.50.3.15 (different from high-score incident)

#### Score Calculation:
```
Severity Sum:    10
Unique Sources:  Suricata = 1 source × 10 = 10
Alert Count:     1 alert × 2 = 2
Total:           10 + 10 + 2 = 22
```

**Expected Result: Score = 22/100**

#### User Flow:
1. Navigate to `/incident`
2. Scroll or filter to second incident (IP: 10.50.3.15)
3. See badge: "REVIEW REQUIRED (22/100)" in amber
4. Status shows "Needs Review"
5. "Escalate Incident" button is **enabled**
6. Analyst reviews and makes decision:
   - Click "Escalate Incident" to manually create case
   - Or close via "Classify Incident" if false positive
7. Manual escalation navigates to case with "Escalated incident 10.50.3.15" audit message

#### Verification:
- ✓ Correlation score displayed correctly (22/100)
- ✓ Status shows "Needs Review"
- ✓ "Escalate Incident" button enabled
- ✓ No automatic case creation
- ✓ Analyst has control over escalation decision
- ✓ Manual escalation creates audit entry with manual action type
- ✓ Navigation flow works from escalation

---

## Key Features Verified

### Correlation Score Computation
- [ ] Severity weights applied correctly
- [ ] Source count multiplier working (×10)
- [ ] Alert count multiplier working (×2)
- [ ] Score capped at 100

### Auto-Escalation Logic
- [ ] Incidents with score ≥ 90 auto-create cases
- [ ] Incidents with score < 90 marked as "needs-review"
- [ ] Status field updated correctly
- [ ] Cases created without user interaction for high scores

### UI Components
- [ ] Score badge shows correct value and color
- [ ] Progress bar visual indicator
- [ ] Status text reflects incident state
- [ ] Button states correct (disabled for auto-escalated)

### Navigation & Linking
- [ ] Incident → Case navigation works
- [ ] Case → Incident link functional (clickable ID)
- [ ] Incident URL navigation works: `/incident?id=...`
- [ ] Case URL navigation works: `/cases?id=...`

### Data Integrity
- [ ] Timeline unaffected
- [ ] MITRE mapping still computes correctly
- [ ] Correlation logic unchanged
- [ ] Attack flow display works

### Audit Trail
- [ ] Auto-escalation logged with score
- [ ] Manual escalation logged separately
- [ ] Incident state changes recorded
- [ ] Case creation links logged

---

## Testing Steps

### Setup
1. Start the app: `npm run dev`
2. Navigate to Alerts page to ensure data loads
3. Navigate to Incidents page

### Test High-Score Scenario
1. Observe first incident (192.168.1.7)
2. Note score badge shows "AUTO ESCALATED (100/100)" in red
3. Verify auto-navigation to Cases happens (or check console)
4. Click incident link in case to verify navigation works
5. Verify audit log shows auto-escalation entry

### Test Low-Score Scenario
1. Navigate back to Incidents (or scroll to second incident)
2. Select incident with IP 10.50.3.15
3. Note score badge shows "REVIEW REQUIRED (22/100)" in amber
4. Click "Escalate Incident" button
5. Verify case is created and navigation happens
6. Verify audit log shows manual escalation entry
7. Click incident link in case to navigate back

### Verify No Regressions
1. Check timeline loads alerts in both incidents
2. Verify MITRE mapping shows techniques
3. Check attack flow visualization works
4. Ensure classification/closure workflow still works
5. Verify note-taking functionality works

---

## Expected Behavior Summary

| Aspect | High Score (≥90) | Low Score (<90) |
|--------|---|---|
| **Status** | auto-escalated | needs-review |
| **Badge** | AUTO ESCALATED (red) | REVIEW REQUIRED (amber) |
| **Case Creation** | Automatic | Manual button click |
| **Escalation Button** | Disabled | Enabled |
| **Navigation** | Auto → /cases | Manual → /cases |
| **Audit Entry** | auto-escalate action | create case action |
| **User Control** | None (system decides) | Full analyst control |

