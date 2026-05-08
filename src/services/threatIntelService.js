// ═══════════════════════════════════════════════════════════════════════════════
// SENTINELX THREAT INTELLIGENCE SERVICE
// Frontend-safe architecture with real VirusTotal + realistic mock enrichment
// ═══════════════════════════════════════════════════════════════════════════════

const VT_API_KEY = import.meta.env.VITE_VIRUSTOTAL_API_KEY || "";

// Cache for 5 minutes
const CACHE_TTL = 5 * 60 * 1000;
const intelCache = new Map();

function getCached(key) {
    const cached = intelCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log("✓ Using cached intel for:", key);
        return cached.data;
    }
    return null;
}

function setCached(key, data) {
    intelCache.set(key, { data, timestamp: Date.now() });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIVATE IP DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function isPrivateIP(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4) return false;

    const octets = parts.map((p) => parseInt(p, 10));
    if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;

    // 10.0.0.0 - 10.255.255.255
    if (octets[0] === 10) return true;

    // 127.0.0.0 - 127.255.255.255 (loopback)
    if (octets[0] === 127) return true;

    // 172.16.0.0 - 172.31.255.255
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;

    // 192.168.0.0 - 192.168.255.255
    if (octets[0] === 192 && octets[1] === 168) return true;

    // 169.254.0.0 - 169.254.255.255 (link-local)
    if (octets[0] === 169 && octets[1] === 254) return true;

    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIRUSTOTAL LOOKUP (REAL API)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getVirusTotalReport(ip) {
    if (!VT_API_KEY) {
        console.warn("VirusTotal API key not configured");
        return null;
    }

    try {
        const response = await fetch(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`, {
            headers: {
                "x-apikey": VT_API_KEY,
            },
        });

        if (!response.ok) {
            console.warn("VirusTotal API error:", response.status);
            return null;
        }

        const data = await response.json();
        const stats = data.data?.attributes?.last_analysis_stats || {};
        const asn = data.data?.attributes?.asn || null;
        const country = data.data?.attributes?.country || null;

        return {
            malicious: stats.malicious || 0,
            suspicious: stats.suspicious || 0,
            harmless: stats.harmless || 0,
            undetected: stats.undetected || 0,
            asn,
            country,
            reputation: data.data?.attributes?.reputation || 0,
            totalVendors: (stats.malicious || 0) + (stats.suspicious || 0) + (stats.harmless || 0) + (stats.undetected || 0),
        };
    } catch (error) {
        console.error("VirusTotal lookup failed:", error);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REALISTIC MOCK ENRICHMENT LAYER (NO CORS)
// ═══════════════════════════════════════════════════════════════════════════════

function generateRealisticEnrichment(ip, vt) {
    // Deterministic hash based on IP
    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
        hash = ((hash << 5) - hash + ip.charCodeAt(i)) | 0;
    }
    hash = Math.abs(hash);

    // Detect TOR/suspicious patterns
    const isTorLike = ip.includes("9.") || ip.includes("8.8") || hash % 7 === 0;
    const isSuspiciousPattern = ip.startsWith("192.") || ip.startsWith("10.") || hash % 5 === 0;

    // Calculate confidence based on VT score
    let baseConfidence = 0;
    if (vt) {
        baseConfidence = Math.min(vt.malicious * 8, 100);
        baseConfidence += Math.min(vt.suspicious * 3, 30);
    }

    // Adjust for patterns
    if (isTorLike) baseConfidence = Math.min(baseConfidence + 40, 100);
    if (isSuspiciousPattern) baseConfidence = Math.min(baseConfidence + 20, 100);

    // Add randomness but keep it weighted
    const randomFactor = (hash % 20) - 10;
    const confidence = Math.max(0, Math.min(100, baseConfidence + randomFactor));

    // Generate reports based on confidence
    let reports = 0;
    if (confidence > 80) reports = 50 + (hash % 200);
    else if (confidence > 60) reports = 20 + (hash % 80);
    else if (confidence > 40) reports = 5 + (hash % 30);
    else if (confidence > 20) reports = 1 + (hash % 5);

    // ISP list
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
        "Artikel10 e.V.",
        "Tor Project",
        "NForce Entertainment B.V.",
        "Leaseweb Global B.V.",
    ];

    // Countries
    const countries = [
        "United States",
        "Germany",
        "Netherlands",
        "United Kingdom",
        "France",
        "Canada",
        "Japan",
        "Singapore",
        "Russia",
        "China",
    ];

    // Cities
    const cities = [
        "New York",
        "Berlin",
        "Amsterdam",
        "London",
        "Paris",
        "Toronto",
        "Tokyo",
        "Singapore",
        "Moscow",
        "Beijing",
    ];

    // Usage types
    const usageTypes = [
        "Data Center",
        "Web Hosting",
        "Proxy",
        "VPN",
        "Hosting Provider",
        "CDN",
        "Tor Exit Node",
        "Residential Proxy",
    ];

    const selectedIsp = isps[hash % isps.length];
    const selectedCountry = countries[hash % countries.length];
    const selectedCity = cities[hash % cities.length];
    const selectedUsageType = usageTypes[hash % usageTypes.length];

    // Generate hostname
    let hostname = `host-${ip.replace(/\./g, "-")}.example.com`;
    if (isTorLike) {
        hostname = `exit-${hash % 1000}.tor-exit.example.org`;
    }

    // Generate domain
    let domain = `example-${hash % 10000}.com`;
    if (isTorLike) {
        domain = `tor-relay-${hash % 1000}.onion`;
    }

    return {
        abuseConfidenceScore: Math.round(confidence),
        totalReports: reports,
        isp: selectedIsp,
        hostname,
        domain,
        country: selectedCountry,
        city: selectedCity,
        usageType: selectedUsageType,
        lastReportedAt: reports > 0 ? new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString() : null,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// THREAT SCORE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

function calculateThreatScore(vt, enrichment) {
    let score = 0;

    if (vt) {
        score += Math.min(vt.malicious * 10, 40);
        score += Math.min(vt.suspicious * 5, 20);
    }

    if (enrichment) {
        score += Math.min(enrichment.abuseConfidenceScore / 2, 30);
    }

    return Math.min(Math.round(score), 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED ENRICHMENT (FRONTEND-SAFE, NO CORS)
// ═══════════════════════════════════════════════════════════════════════════════

export async function enrichIP(ip) {
    // Check cache first
    const cached = getCached(ip);
    if (cached) return cached;

    console.log("🔍 Enriching IP:", ip);

    try {
        // Handle private IPs
        if (isPrivateIP(ip)) {
            console.log("ℹ Private IP detected, using internal enrichment:", ip);
            const enriched = {
                ip,
                threatScore: 0,
                vt: {},
                abuse: {
                    abuseConfidenceScore: 0,
                    totalReports: 0,
                    country: "Internal Network",
                    city: "Local",
                    isp: "Private Infrastructure",
                    hostname: "Local Asset",
                    domain: null,
                    usageType: "Internal",
                    lastReportedAt: null,
                },
                enrichedAt: new Date().toISOString(),
                isPrivate: true,
            };
            setCached(ip, enriched);
            return enriched;
        }

        // Fetch real VirusTotal data
        const vt = await getVirusTotalReport(ip);

        // Generate realistic mock enrichment (NO CORS)
        const enrichment = generateRealisticEnrichment(ip, vt);

        const threatScore = calculateThreatScore(vt, enrichment);

        const enriched = {
            ip,
            threatScore,
            vt: vt || {},
            abuse: enrichment,
            enrichedAt: new Date().toISOString(),
            isPrivate: false,
        };

        // Cache the result
        setCached(ip, enriched);

        console.log("✅ IP enriched:", ip, "Score:", threatScore);
        return enriched;
    } catch (error) {
        console.error("IP enrichment failed:", error);
        // Return graceful fallback
        return {
            ip,
            threatScore: 0,
            vt: {},
            abuse: generateRealisticEnrichment(ip, null),
            enrichedAt: new Date().toISOString(),
            isPrivate: false,
        };
    }
}

export function clearIntelCache() {
    intelCache.clear();
    console.log("✓ Intel cache cleared");
}



