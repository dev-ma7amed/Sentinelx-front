export const mockUsers = [
  {
    id: 1,
    name: "Admin User",
    email: "admin@sentinelx.io",
    password: "Admin123!",
    role: "Administrator",
    avatar: ""
  },
  {
    id: 2,
    name: "SOC Analyst",
    email: "analyst@sentinelx.io",
    password: "Analyst123!",
    role: "SOC Analyst",
    avatar: ""
  },
  {
    id: 3,
    name: "Viewer User",
    email: "viewer@sentinelx.io",
    password: "Viewer123!",
    role: "Viewer",
    avatar: ""
  }
];

export const rolePermissions = {
  Administrator: {
    canAccessSettings: true,
    canAccessCases: true,
    canAccessAudit: true,
    canAccessIntelligence: true,
    canAccessUserManagement: true,
    canAccessAlerts: true,
    canAccessIncidents: true,
    canEdit: true,
    canClassify: true,
    canEscalate: true,
    canClose: true
  },
  "SOC Analyst": {
    canAccessSettings: false,
    canAccessCases: true,
    canAccessAudit: false,
    canAccessIntelligence: true,
    canAccessUserManagement: false,
    canAccessAlerts: true,
    canAccessIncidents: true,
    canEdit: true,
    canClassify: true,
    canEscalate: true,
    canClose: true
  },
  Viewer: {
    canAccessSettings: false,
    canAccessCases: false,
    canAccessAudit: false,
    canAccessIntelligence: false,
    canAccessUserManagement: false,
    canAccessAlerts: false,
    canAccessIncidents: true,
    canEdit: false,
    canClassify: false,
    canEscalate: false,
    canClose: false
  }
};
