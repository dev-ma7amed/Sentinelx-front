# Backend Implementation Specification (Laravel Focus)

This document provides a highly granular, code-level blueprint for building the **SentinelX** backend. Given the developer environment is running on **Laragon**, this specification outlines concrete examples using **PHP 8.2+** and **Laravel 11.x**.

---

## 1. Webhook Intake Optimization & Scaling
To handle burst traffic from security sensors without dropouts, the intake controller must use a **Queue-on-Receipt** design pattern. 

### 1.1 Ingestion Controller Example (`WebhookController.php`)
```php
<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessAlertCorrelation;
use App\Models\RawIngestDump;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class WebhookController extends Controller
{
    /**
     * Accepts telemetry webhook events.
     * High throughput: saves raw JSON and queues parsing asynchronously.
     */
    public function receiveAlert(Request $request): JsonResponse
    {
        // 1. Basic Token Check
        $token = $request->header('X-SentinelX-Key');
        if ($token !== config('services.sentinelx.webhook_key')) {
            return response()->json(['error' => 'Unauthorized sensor token.'], 401);
        }

        // 2. Immediate Ingestion Staging
        $rawLog = RawIngestDump::create([
            'payload' => $request->all(),
            'source_ip' => $request->ip(),
        ]);

        // 3. Dispatch to Redis Worker
        ProcessAlertCorrelation::dispatch($rawLog->id);

        // 4. Low Latency Response
        return response()->json([
            'message' => 'Alert received and staged for analysis.',
            'staging_id' => $rawLog->id
        ], 202);
    }
}
```

---

## 2. Ingest Data Collection & Indexing Guidelines
When the background worker parses the queued job, it must extract and normalize fields into specific database columns. Below is the precise mapping for data normalization:

### 2.1 Extraction Matrix for Incoming Payloads

| Normalized Column | Primary Location in Raw Payload | Fallback Locations | Extraction Rationale |
| :--- | :--- | :--- | :--- |
| `src_ip` | `payload.srcIP` | `payload.srcip`, `payload.src_ip`, `payload.data.srcip`, `payload.agent.ip` | **Critical**. This is the key grouped by the Correlation Engine. Must be indexed. |
| `dst_ip` | `payload.dstIP` | `payload.dstip`, `payload.dst_ip`, `payload.data.dstip` | Target identifier for containment actions. |
| `hostname` | `payload.hostname` | `payload.host`, `payload.agent.name`, `payload.computerName`, `payload.data.hostname` | Correlated device target. |
| `username` | `payload.user` | `payload.username`, `payload.data.user`, `payload.win.eventdata.targetUserName` | Analyst visibility context. |
| `severity` | `payload.severity` | Maps rule threat levels: `payload.rule.level` or standard weightings | Determines Risk Score base weight. |
| `type` | `payload.type` | `payload.event_type`, `payload.rule.description` | Categorizes threat vector class. |
| `description` | `payload.desc` | `payload.description`, `payload.message`, `payload.full_log` | Detailed context. |

### 2.2 Laravel Migration Schema Definitions

To ensure high-performance, write the following indexes in the migrations:

```php
Schema::create('alerts', function (Blueprint $table) {
    $table->string('id')->primary(); // e.g. WZH-9921
    $table->string('incident_id')->nullable()->index();
    $table->string('correlation_id')->index();
    $table->enum('severity', ['low', 'medium', 'high', 'critical']);
    $table->string('raw_severity');
    $table->string('source'); // Wazuh, Sysmon, Suricata, Network ML
    $table->string('type');
    $table->text('description');
    $table->text('sub_description')->nullable();
    $table->string('src_ip', 45)->index(); // Indexed for grouping
    $table->string('dst_ip', 45)->nullable();
    $table->string('hostname')->nullable()->index();
    $table->string('username')->nullable();
    $table->enum('status', ['new', 'in-progress', 'resolved'])->default('new')->index();
    $table->json('raw_payload')->nullable();
    $table->boolean('false_positive')->default(false);
    $table->string('assigned_to')->nullable();
    $table->timestamps();
    
    // Composite index for fast temporal grouping queries
    $table->index(['src_ip', 'created_at']);
});
```

---

## 3. Threat Intelligence Integrations (Real API Spec)
The backend must run a unified threat intel aggregation service with HTTP clients, structured logging, and strict caching rules.

### 3.1 Caching Strategy
*   **Driver**: Redis Cache.
*   **Time-to-Live (TTL)**: 5 minutes.
*   **Reasoning**: Prevents rapid external API exhaustion (especially VirusTotal public tier limits) when an IP triggers hundreds of events concurrently during an ongoing attack.

### 3.2 External Integration Client (`ThreatIntelService.php`)
```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class ThreatIntelService
{
    protected string $vtApiKey;
    protected string $abuseApiKey;

    public function __construct()
    {
        $this->vtApiKey = config('services.virustotal.key', '');
        $this->abuseApiKey = config('services.abuseipdb.key', '');
    }

    /**
     * Get unified report for an IP. Checks Cache.
     */
    public function enrichIP(string $ip): array
    {
        // 1. Private Network Guard (RFC 1918)
        if ($this->isPrivateIP($ip)) {
            return [
                'ip' => $ip,
                'threatScore' => 0,
                'isPrivate' => true,
                'vt' => (object)[],
                'abuse' => [
                    'abuseConfidenceScore' => 0,
                    'totalReports' => 0,
                    'country' => 'Internal Network',
                    'isp' => 'Private Infrastructure',
                    'usageType' => 'Internal',
                ]
            ];
        }

        // 2. Fetch from Cache
        return Cache::remember("intel_enrich_{$ip}", 300, function () use ($ip) {
            $vtData = $this->getVirusTotalReport($ip);
            $abuseData = $this->getAbuseIPDBReport($ip);
            
            $threatScore = $this->calculateThreatScore($vtData, $abuseData);

            return [
                'ip' => $ip,
                'threatScore' => $threatScore,
                'isPrivate' => false,
                'vt' => $vtData,
                'abuse' => $abuseData,
                'enrichedAt' => now()->toIso8601String()
            ];
        });
    }

    protected function isPrivateIP(string $ip): bool
    {
        return !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }

    protected function getVirusTotalReport(string $ip): array
    {
        if (empty($this->vtApiKey)) return [];

        $response = Http::withHeaders(['x-apikey' => $this->vtApiKey])
            ->get("https://www.virustotal.com/api/v3/ip_addresses/{$ip}");

        if (!$response->successful()) return [];

        $attributes = $response->json('data.attributes', []);
        $stats = $attributes['last_analysis_stats'] ?? [];

        return [
            'malicious' => $stats['malicious'] ?? 0,
            'suspicious' => $stats['suspicious'] ?? 0,
            'harmless' => $stats['harmless'] ?? 0,
            'undetected' => $stats['undetected'] ?? 0,
            'asn' => $attributes['asn'] ?? null,
            'country' => $attributes['country'] ?? null,
            'reputation' => $attributes['reputation'] ?? 0,
        ];
    }

    protected function getAbuseIPDBReport(string $ip): array
    {
        if (empty($this->abuseApiKey)) return [];

        $response = Http::withHeaders(['Key' => $this->abuseApiKey, 'Accept' => 'application/json'])
            ->get("https://api.abuseipdb.com/api/v2/check", [
                'ipAddress' => $ip,
                'maxAgeInDays' => 30
            ]);

        if (!$response->successful()) return [];

        $data = $response->json('data', []);

        return [
            'abuseConfidenceScore' => $data['abuseConfidenceScore'] ?? 0,
            'totalReports' => $data['totalReports'] ?? 0,
            'isp' => $data['isp'] ?? 'Unknown',
            'domain' => $data['domain'] ?? null,
            'country' => $data['countryName'] ?? null,
            'city' => $data['cityName'] ?? null,
            'usageType' => $data['usageType'] ?? 'Unknown',
            'lastReportedAt' => $data['lastReportedAt'] ?? null,
        ];
    }

    protected function calculateThreatScore(array $vt, array $abuse): int
    {
        $score = 0;
        
        if (!empty($vt)) {
            $score += min(($vt['malicious'] ?? 0) * 10, 40);
            $score += min(($vt['suspicious'] ?? 0) * 5, 20);
        }

        if (!empty($abuse)) {
            $score += min(($abuse['abuseConfidenceScore'] ?? 0) / 2, 30);
        }

        return min(max($score, 0), 100);
    }
}
```

---

## 4. Reset to Demo Mode Endpoint
In compliance with the frontend's ability to trigger state resets (`window.resetToDemo()`), the backend must expose a guarded endpoint: `POST /api/v1/system/reset-demo`.

*   **Role Permission Requirement**: Strictly restricted to **Administrator** sessions only.
*   **Logic Execution**:
    1.  Clear current `cases`, `notes`, and `timeline_events` tables.
    2.  Clear `incident_audit_logs` and standard `audit_logs` tables.
    3.  Load seeded initial alert data from the `ALERTS_PLAIN` data file.
    4.  Run the initial correlation mapping step.
    5.  Trigger a WebSocket broadcast to notify clients to hard-reload states.
