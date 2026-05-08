const defaultWhoisRows = () => [
    { property: "Registrar", value: "GoDaddy.com, LLC", source: "Whois", mono: true },
    { property: "Created Date", value: "2021-08-12 14:22:01", source: "Whois", mono: true },
    {
        property: "Associated Domains",
        value: null,
        domains: ["update.win-defender.co", "cdn-nodes.delivery.io"],
        source: "Passive DNS",
    },
];

const hashTick = (ip, tick) => {
    let h = 0;
    for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
    return Math.abs(h) + tick * 11;
};

const generateDynamicLogs = (ip, tick) => {
    const t = hashTick(ip || "", tick);
    const logIp = ip && ip.includes(".") ? ip : `related-${(ip || "x").slice(0, 8)}`;

    const logTypes = [
        {
            title: "Edge-FW-01: Denied connection",
            desc: `Source: ${logIp} → Dest: 10.0.4.15 (Port 2323)`,
            icon: "router",
            iconColor: "amber",
        },
        {
            title: "Suricata IDS: ET EXPLOIT Potential Mirai",
            desc: "Signature ID: 2023001 | Alert level: 2",
            icon: "shield",
            iconColor: "blue",
        },
        {
            title: "Wazuh: Multiple failed SSH attempts",
            desc: `Source: ${logIp} → Dest: 10.0.2.8 (Port 22) | Attempts: ${12 + (t % 40)}`,
            icon: "router",
            iconColor: "red",
        },
        {
            title: "Zeek DNS: Suspicious domain query",
            desc: `Query: malware-c2.xyz from ${logIp} | Response: NXDOMAIN`,
            icon: "shield",
            iconColor: "amber",
        },
        {
            title: "Snort: Possible trojan activity",
            desc: "Signature: Trojan.Generic.TCP | Confidence: High",
            icon: "shield",
            iconColor: "red",
        },
        {
            title: "Firewall: Port scan detected",
            desc: `Source: ${logIp} → Scanning ports 1-1024 | Duration: ${5 + (t % 15)}s`,
            icon: "router",
            iconColor: "amber",
        },
        {
            title: "Osquery: Suspicious process spawned",
            desc: "Process: cmd.exe | Parent: explorer.exe | Hash mismatch detected",
            icon: "shield",
            iconColor: "red",
        },
        {
            title: "Sysmon: Network connection established",
            desc: `Destination: ${logIp}:${2000 + (t % 8000)} | Protocol: TCP`,
            icon: "router",
            iconColor: "blue",
        },
    ];

    // Generate 3-6 random log events
    const numLogs = 3 + (t % 4);
    const logs = [];
    for (let i = 0; i < numLogs; i++) {
        const logType = logTypes[(t + i) % logTypes.length];
        const minutesAgo = 5 + (t % 55) + (i * 3);
        const now = new Date();
        const logTime = new Date(now.getTime() - minutesAgo * 60000);
        const timeStr = logTime.toISOString().slice(0, 19).replace("T", " ");

        logs.push({
            title: logType.title,
            desc: logType.desc,
            time: timeStr,
            icon: logType.icon,
            iconColor: logType.iconColor,
        });
    }

    return logs.sort((a, b) => new Date(b.time) - new Date(a.time));
};

const generateDynamicGeo = (ip, tick) => {
    const t = hashTick(ip || "", tick);
    const geoLocations = [
        { city: "Frankfurt am Main", label: "Frankfurt, Germany (DE)", asn: "AS14061" },
        { city: "Amsterdam", label: "Amsterdam, NL (EU)", asn: "AS8075" },
        { city: "London", label: "London, UK (EU)", asn: "AS2856" },
        { city: "Moscow", label: "Moscow, Russia (RU)", asn: "AS8452" },
        { city: "Singapore", label: "Singapore, SG (APAC)", asn: "AS3352" },
        { city: "Tokyo", label: "Tokyo, Japan (APAC)", asn: "AS2914" },
        { city: "São Paulo", label: "São Paulo, Brazil (SA)", asn: "AS7738" },
        { city: "Toronto", label: "Toronto, Canada (NA)", asn: "AS577" },
    ];

    return geoLocations[t % geoLocations.length];
};

const generateDynamicISP = (ip, tick) => {
    const t = hashTick(ip || "", tick);
    const isps = [
        "DigitalOcean, LLC",
        "Amazon AWS",
        "Linode, LLC",
        "Vultr Holdings, LLC",
        "OVH SAS",
        "Hetzner Online GmbH",
        "Alibaba Cloud",
        "Google Cloud",
        "Microsoft Azure",
        "Contabo GmbH",
    ];

    return isps[t % isps.length];
};

const generateDynamicTags = (ip, tick) => {
    const t = hashTick(ip || "", tick);
    const tagSets = [
        ["Trojan.Generic", "Downloader", "Mirai-C"],
        ["Botnet", "C2", "Worm"],
        ["Ransomware", "Dropper", "Backdoor"],
        ["Spyware", "Keylogger", "Infostealer"],
        ["Rootkit", "Privilege Escalation", "Persistence"],
        ["Exploit Kit", "Shellcode", "Payload"],
    ];

    return tagSets[t % tagSets.length];
};

const generateDynamicSandbox = (ip, tick) => {
    const t = hashTick(ip || "", tick);
    const behaviors = [
        "Contacted 12 domains, modified 3 system registry keys, and initiated outbound TCP on port 2323.",
        "Spawned 5 child processes, attempted privilege escalation, and created persistence mechanism.",
        "Established C2 connection, exfiltrated 2.3MB of data, and disabled Windows Defender.",
        "Injected code into 8 processes, modified hosts file, and created scheduled task.",
        "Downloaded additional payload, modified firewall rules, and established reverse shell.",
        "Enumerated network shares, attempted lateral movement, and created hidden user account.",
    ];

    return behaviors[t % behaviors.length];
};

/** Plain-JSON envelope matching expected /api/intelligence response shape. */
export function mockIntelEnvelope(ip, tick = 0) {
    const t = hashTick(ip || "", tick);
    const geo = generateDynamicGeo(ip, tick);
    const isp = generateDynamicISP(ip, tick);
    const tags = generateDynamicTags(ip, tick);
    const sandbox = generateDynamicSandbox(ip, tick);
    const logs = generateDynamicLogs(ip, tick);

    return {
        virustotal: {
            detections: 35 + (t % 34),
            total: 72,
            tags,
            sandbox,
        },
        abuseipdb: {
            confidence: (85 + (t % 15)) + "%",
            reports: 820 + (t % 760),
            last_reported: (5 + (t % 55)) + " minutes ago",
            usage_type: "Data Center/Web Hosting/Proxy",
            isp,
        },
        whois: {
            geo,
            rows: defaultWhoisRows(),
        },
        internal_logs: logs,
        risk: 62 + (t % 30),
    };
}

export function mergeIntelApi(remote, ip, tick) {
    const base = mockIntelEnvelope(ip, tick);
    if (!remote || typeof remote !== "object") return base;
    const vt = { ...base.virustotal, ...(remote.virustotal || {}) };
    const ab = { ...base.abuseipdb, ...(remote.abuseipdb || {}) };
    const wh = {
        ...base.whois,
        ...(remote.whois || {}),
        geo: { ...base.whois.geo, ...(remote.whois && remote.whois.geo ? remote.whois.geo : {}) },
        rows: (remote.whois && Array.isArray(remote.whois.rows) && remote.whois.rows.length
            ? remote.whois.rows
            : base.whois.rows),
    };
    const logs = Array.isArray(remote.internal_logs) && remote.internal_logs.length
        ? remote.internal_logs
        : base.internal_logs;
    return {
        virustotal: vt,
        abuseipdb: ab,
        whois: wh,
        internal_logs: logs,
        risk: typeof remote.risk === "number" ? remote.risk : base.risk,
    };
}
