function pad2(n) {
    return String(n).padStart(2, "0");
}

/**
 * @param {Date | number | string | null | undefined} date
 * @returns {string}
 */
export function formatTime(date) {
    if (date == null || date === "") return "—";
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return typeof date === "string" ? date : "—";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = pad2(d.getDate());
    const mon = months[d.getMonth()];
    let h = d.getHours();
    const m = pad2(d.getMinutes());
    const am = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${day} ${mon} • ${pad2(h)}:${m} ${am}`;
}
