export const ALERTS = [
  {
    id: "NET-2201",
    date: "2023-10-24",
    time: "14:22:12",
    severity: "high",
    source: "Network ML",
    type: "Network Flow",
    desc: "Malicious Traffic Pattern",
    sub: "ML classification = Malicious",
    srcIP: "192.168.1.7",
    dstIP: "45.12.33.9",
    status: "new",
    assignedTo: "CURRENT_USER",
  },
  {
    id: "WZH-9921",
    date: "2023-10-24",
    time: "14:20:01",
    severity: "critical",
    source: "Wazuh",
    type: "Security Log",
    desc: "Multiple Failed SSH Logins",
    sub: "Brute force detection",
    srcIP: "192.168.1.5",
    dstIP: "10.0.0.1",
    status: "new",
  },
];

export const INCIDENTS = [
  {
    id: "INC-8824",
    severity: "critical",
    title: "Multi-stage Attack",
    alerts: ["NET-2201", "WZH-9921"],
    timeline: [
      {
        title: "Brute Force Attempt",
        time: "14:22:05",
        source: "Wazuh",
      },
      {
        title: "Lateral Movement",
        time: "14:25:12",
        source: "Sysmon",
      },
    ],
  },
];

export function enrichAlerts(alerts) {
  return alerts.map((a) => ({ ...a }));
}

export function generateIncidents(alerts) {
  const grouped = {};

  alerts.forEach((a) => {
    const key = a.srcIP;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  });

  return Object.entries(grouped).map(([ip, groupedAlerts]) => ({
    id: `INC-${ip}`,
    severity: groupedAlerts.some((a) => a.severity === "critical") ? "critical" : "high",
    alerts: groupedAlerts,
  }));
}
