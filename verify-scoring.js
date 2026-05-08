#!/usr/bin/env node

/**
 * Auto Case Implementation Verification Script
 *
 * This script verifies the correlation score calculation for the two test scenarios.
 */

const SEVERITY_WEIGHTS = {
  critical: 40,
  high: 30,
  medium: 20,
  low: 10,
};

function computeCorrelationScore(alertList) {
  if (!Array.isArray(alertList) || alertList.length === 0) return 0;

  const severitySum = alertList.reduce((sum, alert) => {
    const weight = SEVERITY_WEIGHTS[alert.severity] || SEVERITY_WEIGHTS.low;
    return sum + weight;
  }, 0);

  const uniqueSources = new Set(alertList.map((a) => a.source)).size;
  const alertCount = alertList.length;

  const score = severitySum + (uniqueSources * 10) + (alertCount * 2);
  return Math.min(score, 100);
}

// Scenario 1: High Score Incident (192.168.1.7)
const highScoreAlerts = [
  { id: "NET-2201", severity: "high", source: "Network ML" },
  { id: "WZH-9921", severity: "critical", source: "Wazuh" },
  { id: "SYS-4102", severity: "high", source: "Sysmon" },
  { id: "WZH-9918", severity: "high", source: "Suricata" },
  { id: "SYS-4098", severity: "low", source: "Sysmon" },
  { id: "WZH-9915", severity: "medium", source: "Wazuh" },
];

// Scenario 2: Low Score Incident (10.50.3.15)
const lowScoreAlerts = [
  { id: "SUR-7734", severity: "low", source: "Suricata" },
];

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║        Auto Case Implementation Verification Script            ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

// Scenario 1
console.log("📊 SCENARIO 1: HIGH SCORE INCIDENT (192.168.1.7)");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

let severitySum1 = 0;
highScoreAlerts.forEach(alert => {
  const weight = SEVERITY_WEIGHTS[alert.severity];
  severitySum1 += weight;
  console.log(`  ${alert.id} (${alert.source}) - Severity: ${alert.severity} Weight: ${weight}`);
});

const uniqueSources1 = new Set(highScoreAlerts.map(a => a.source)).size;
const alertCount1 = highScoreAlerts.length;

console.log("\n  Calculation:");
console.log(`    Severity Sum:     ${severitySum1}`);
console.log(`    Unique Sources:   ${uniqueSources1} × 10 = ${uniqueSources1 * 10}`);
console.log(`    Alert Count:      ${alertCount1} × 2 = ${alertCount1 * 2}`);

const score1 = computeCorrelationScore(highScoreAlerts);
console.log(`    ─────────────────────`);
console.log(`    Total:            ${severitySum1} + ${uniqueSources1 * 10} + ${alertCount1 * 2} = ${severitySum1 + uniqueSources1 * 10 + alertCount1 * 2}`);
console.log(`    Capped at 100:    ${score1}`);

console.log(`\n  ✓ Status: ${score1 >= 90 ? "AUTO-ESCALATED" : "NEEDS-REVIEW"} (${score1}/100)`);
console.log(`  ✓ Case Action: ${score1 >= 90 ? "CREATE AUTOMATICALLY" : "MANUAL ESCALATION"}\n`);

// Scenario 2
console.log("📊 SCENARIO 2: LOW SCORE INCIDENT (10.50.3.15)");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

let severitySum2 = 0;
lowScoreAlerts.forEach(alert => {
  const weight = SEVERITY_WEIGHTS[alert.severity];
  severitySum2 += weight;
  console.log(`  ${alert.id} (${alert.source}) - Severity: ${alert.severity} Weight: ${weight}`);
});

const uniqueSources2 = new Set(lowScoreAlerts.map(a => a.source)).size;
const alertCount2 = lowScoreAlerts.length;

console.log("\n  Calculation:");
console.log(`    Severity Sum:     ${severitySum2}`);
console.log(`    Unique Sources:   ${uniqueSources2} × 10 = ${uniqueSources2 * 10}`);
console.log(`    Alert Count:      ${alertCount2} × 2 = ${alertCount2 * 2}`);

const score2 = computeCorrelationScore(lowScoreAlerts);
console.log(`    ─────────────────────`);
console.log(`    Total:            ${severitySum2} + ${uniqueSources2 * 10} + ${alertCount2 * 2} = ${severitySum2 + uniqueSources2 * 10 + alertCount2 * 2}`);
console.log(`    Capped at 100:    ${score2}`);

console.log(`\n  ✓ Status: ${score2 >= 90 ? "AUTO-ESCALATED" : "NEEDS-REVIEW"} (${score2}/100)`);
console.log(`  ✓ Case Action: ${score2 >= 90 ? "CREATE AUTOMATICALLY" : "MANUAL ESCALATION"}\n`);

// Verification
console.log("✅ VERIFICATION");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`[${score1 >= 90 ? "✓" : "✗"}] Scenario 1 auto-escalates (score=${score1}, threshold=90)`);
console.log(`[${score2 < 90 ? "✓" : "✗"}] Scenario 2 requires review (score=${score2}, threshold=90)`);
console.log(`[${score1 === 100 ? "✓" : "✗"}] Scenario 1 capped at 100`);
console.log(`[${score1 > score2 ? "✓" : "✗"}] High-score incident > Low-score incident`);

const allPassed = (score1 >= 90) && (score2 < 90) && (score1 === 100) && (score1 > score2);
console.log(`\n${allPassed ? "✅ ALL CHECKS PASSED" : "❌ SOME CHECKS FAILED"}\n`);
