export const LS_AUTH = "isAuth";
export const LS_USER = "currentUser";
export const LS_ROLE = "currentRole";
export const LS_USERS = "soc_users";
const LS_USERS_LEGACY = "socUsers";

export function getRole() {
    return (localStorage.getItem(LS_ROLE) || "analyst").toLowerCase();
}

/** @returns {{ id: string, name: string, email: string, roleType: string } | null} */
export function patchCurrentUserDisplay(name) {
    patchCurrentUserContact(name, undefined);
}

/** Update signed-in user display name and/or work email in local session. */
export function patchCurrentUserContact(name, email) {
    const u = getCurrentUser();
    if (!u) return;
    const n = name !== undefined ? String(name || "").trim() : "";
    const em = email !== undefined ? String(email || "").trim() : "";
    const next = {
        ...u,
        ...(n ? { name: n } : {}),
        ...(em ? { email: em } : {}),
    };
    if (n || em) localStorage.setItem(LS_USER, JSON.stringify(next));
}

export function getCurrentUser() {
    const raw = localStorage.getItem(LS_USER);
    if (!raw) return null;
    try {
        const o = JSON.parse(raw);
        if (o && typeof o === "object" && (o.name || o.email)) {
            return {
                id: String(o.id || ""),
                name: String(o.name || "").trim() || (o.email || "").split("@")[0] || "User",
                email: String(o.email || "").trim(),
                roleType: String(o.roleType || getRole() || "analyst").toLowerCase(),
            };
        }
    } catch {
        /* legacy plain string */
    }
    const name = raw.trim();
    if (!name) return null;
    return { id: "legacy", name, email: "", roleType: getRole() };
}

export function userDisplayName(u) {
    if (!u) return "Analyst";
    return (u.name || "").trim() || (u.email || "").split("@")[0] || "Analyst";
}

export function isViewer() {
    const u = getCurrentUser();
    if (u?.roleType) return u.roleType.toLowerCase() === "viewer";
    return getRole() === "viewer";
}

export function canMutate() {
    return !isViewer();
}

export function roleLabelFromType(rt) {
    const r = (rt || "analyst").toLowerCase();
    if (r === "admin") return "Admin";
    if (r === "viewer") return "Viewer";
    return "Analyst";
}

export function roleTypeFromLabel(label) {
    const s = (label || "").toLowerCase();
    if (s === "admin" || s === "administrator") return "admin";
    if (s === "viewer") return "viewer";
    return "analyst";
}

export const SOC_USERS_SEED = [
    { id: "u1", initials: "AR", name: "Alex Rivera", email: "alex.r@cybersec.io", role: "Admin", roleType: "admin", password: "demo123", status: "active", lastLogin: "2 mins ago" },
    { id: "u2", initials: "SC", name: "Sarah Chen", email: "s.chen@cybersec.io", role: "Analyst", roleType: "analyst", password: "demo123", status: "active", lastLogin: "1 hour ago" },
    { id: "u3", initials: "JW", name: "James Wilson", email: "j.wilson@cybersec.io", role: "Viewer", roleType: "viewer", password: "demo123", status: "active", lastLogin: "3 days ago" },
];

export function ensureSocUsers() {
    const cur = readSocUsers();
    if (cur && Array.isArray(cur) && cur.length) return;
    writeSocUsers(SOC_USERS_SEED);
}

export function readSocUsers() {
    try {
        let raw = localStorage.getItem(LS_USERS);
        if (!raw) {
            const legacy = localStorage.getItem(LS_USERS_LEGACY);
            if (legacy) {
                localStorage.setItem(LS_USERS, legacy);
                localStorage.removeItem(LS_USERS_LEGACY);
                raw = legacy;
            }
        }
        if (raw) return JSON.parse(raw);
    } catch {
        /* ignore */
    }
    return null;
}

export function writeSocUsers(list) {
    localStorage.setItem(LS_USERS, JSON.stringify(list));
}

export function tryLogin(email, password) {
    ensureSocUsers();
    const users = readSocUsers();
    if (!users?.length) return { ok: false, error: "No users configured" };
    const em = (email || "").trim().toLowerCase();
    const pw = password || "";
    const u = users.find((x) => (x.email || "").trim().toLowerCase() === em);
    if (!u) return { ok: false, error: "Unknown email" };
    const expected = u.password || "demo123";
    if (pw !== expected) return { ok: false, error: "Invalid password" };
    if (u.status && u.status !== "active") return { ok: false, error: "Account suspended" };
    const name = (u.name || "").trim() || (u.email || "").split("@")[0] || "Analyst";
    const roleType = (u.roleType || "analyst").toLowerCase();
    const lastLoginIso = new Date().toISOString();
    const updatedUsers = users.map((x) => (x.id === u.id ? { ...x, lastLogin: lastLoginIso } : x));
    writeSocUsers(updatedUsers);
    const userObj = {
        id: String(u.id || ""),
        name,
        email: String(u.email || em),
        roleType,
        lastLogin: lastLoginIso,
    };
    localStorage.setItem(LS_AUTH, "true");
    localStorage.setItem(LS_USER, JSON.stringify(userObj));
    localStorage.setItem(LS_ROLE, roleType);
    return { ok: true };
}

export function logoutSession() {
    localStorage.removeItem(LS_AUTH);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_ROLE);
}
