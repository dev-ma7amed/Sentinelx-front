export { ALERTS_PLAIN } from "../mocks/alertsPlain.jsx";

export function enrichAlerts(alerts) {
  return (Array.isArray(alerts) ? alerts : []).map((alert) => ({ ...alert }));
}
