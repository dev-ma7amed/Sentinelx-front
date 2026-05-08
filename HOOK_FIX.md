# Hook Usage Fix Summary

## Issue Fixed: Invalid Hook Call in IncidentPage.jsx

### Problem
The component had a `useRef` hook call inside a `useEffect` callback, which violates React's rules of hooks. This causes the error:
```
React: "Invalid hook call. Hooks can only be called at the top level of a function component."
```

### Solution Applied

#### 1. **Moved All Hooks to Top Level**
All `useRef` declarations are now at the top of the component (lines 81-83):
```javascript
const assignOnceRef = useRef(false);
const createAutoCaseRef = useRef(false);
const scanTimerRef = useRef(null);
```

#### 2. **Removed Duplicate Declaration**
Removed duplicate `scanTimerRef = useRef(null)` that was at line 301 inside the component body.

#### 3. **Fixed Auto-Escalation Effect**
The useEffect for auto-escalation now:
- Uses `createAutoCaseRef` that was defined at the top level
- Keeps the effect logic clean (no hook declarations inside)
- Uses the ref as a guard to run only once

**Before:**
```javascript
useEffect(() => {
    if (!incident || incident.status !== "auto-escalated") return;
    const createAutoCaseRef = useRef(false);  // ❌ INVALID
    if (createAutoCaseRef.current) return;
    // ... rest of effect
}, [incident?.id, incident?.status]);
```

**After:**
```javascript
// At top level
const createAutoCaseRef = useRef(false);  // ✅ VALID

// Inside useEffect
useEffect(() => {
    if (!incident || incident.status !== "auto-escalated") return;
    if (!canMutate()) return;
    if (createAutoCaseRef.current) return;  // Use ref from top level
    createAutoCaseRef.current = true;       // Guard against re-runs
    // ... rest of effect
}, [incident?.id, incident?.status]);
```

### Hook Ordering (Top Level)

**React Hooks (Lines 59-88):**
1. `useNavigate()` — Router navigation
2. `useLocation()` — Current location
3. `useParams()` — URL parameters
4. `useState()` — 13 state declarations
5. `useRef()` — 3 refs (assignOnceRef, createAutoCaseRef, scanTimerRef)
6. `useMemo()` — 4 memoized values
7. `useEffect()` — Effects follow after all hooks declared

**Memoized Values (Lines 94-109):**
- `relatedAlerts` — Depends on incident
- `baseAlert` — Depends on alertId and relatedAlerts
- Derived values (ip, assignedToDisplay, etc.)

**Effects (Lines 111-151):**
1. Platform data listener
2. Incident selection logic
3. Auto-escalation with single-run guard
4. Timeline building (line 154+)
5. Classification effect
6. Scan timer cleanup

### Verification

- [x] Build passes without errors
- [x] No hook calls inside useEffect callbacks
- [x] No hook calls inside conditional blocks
- [x] No hook calls inside helper functions
- [x] Auto-escalation runs only once (protected by createAutoCaseRef)
- [x] Timeline rendering unaffected
- [x] MITRE mapping unaffected
- [x] Correlation logic unaffected
- [x] Navigation flow preserved

### Files Changed
- `src/pages/IncidentPage.jsx` — Fixed hook usage

### Testing
Run `npm run build` — confirms no errors or warnings related to hook usage.

