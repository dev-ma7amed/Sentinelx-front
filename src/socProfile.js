export const LS_SOC_USER = "soc_user";
const LS_PROFILE_DATA = "profile_data";
const LS_PROFILE_AVATAR = "profile_avatar";

const DEFAULT_PROFILE = { name: "", role: "", avatar: "", email: "" };

export function readSocProfile() {
    let name = "";
    let role = "";
    let avatar = "";
    let email = "";
    try {
        const raw = localStorage.getItem(LS_SOC_USER);
        if (raw) {
            const o = JSON.parse(raw);
            if (o && typeof o === "object") {
                name = typeof o.name === "string" ? o.name : "";
                role = typeof o.role === "string" ? o.role : "";
                avatar = typeof o.avatar === "string" ? o.avatar : "";
                email = typeof o.email === "string" ? o.email : "";
            }
        }
    } catch {
        /* ignore */
    }
    try {
        const rawPd = localStorage.getItem(LS_PROFILE_DATA);
        if (rawPd) {
            const pd = JSON.parse(rawPd);
            if (pd && typeof pd === "object") {
                if (typeof pd.name === "string" && pd.name.trim()) name = pd.name;
                if (typeof pd.role === "string" && pd.role.trim()) role = pd.role;
                if (typeof pd.email === "string") email = pd.email;
                if (typeof pd.avatar === "string" && pd.avatar.trim()) avatar = pd.avatar;
            }
        }
    } catch {
        /* ignore */
    }
    try {
        const pa = localStorage.getItem(LS_PROFILE_AVATAR);
        if (pa && String(pa).trim()) avatar = String(pa).trim();
    } catch {
        /* ignore */
    }
    return { ...DEFAULT_PROFILE, name, role, avatar, email };
}

export function writeSocProfile(partial) {
    const next = { ...readSocProfile(), ...(partial && typeof partial === "object" ? partial : {}) };
    const payloadUser = {
        name: next.name || "",
        role: next.role || "",
        avatar: next.avatar || "",
        email: next.email || "",
    };
    localStorage.setItem(LS_SOC_USER, JSON.stringify(payloadUser));
    localStorage.setItem(
        LS_PROFILE_DATA,
        JSON.stringify({
            name: next.name || "",
            email: next.email || "",
            avatar: next.avatar || "",
        }),
    );
    if (next.avatar && String(next.avatar).trim()) {
        localStorage.setItem(LS_PROFILE_AVATAR, String(next.avatar).trim());
    } else {
        localStorage.removeItem(LS_PROFILE_AVATAR);
    }
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("soc_profile_update"));
    }
}

export function ensureSocProfileDefaults() {
    const cur = readSocProfile();
    if (!cur.name && !cur.role && !cur.avatar && !cur.email) {
        writeSocProfile({ name: "Analyst", role: "SOC Analyst", avatar: "", email: "" });
    }
}
