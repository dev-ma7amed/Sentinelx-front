import { useEffect, useMemo, useRef, useState } from "react";
import { X, Sparkles, CheckCircle, XCircle, Copy } from "lucide-react";
import "../../styles/ClassifyModal.css";

const options = [
    { value: "tp", label: "True Positive", icon: <CheckCircle size={22} />, color: "blue" },
    { value: "fp", label: "False Positive", icon: <XCircle size={22} />, color: "red" },
    { value: "dup", label: "Duplicate", icon: <Copy size={22} />, color: "orange" },
];

function incidentScore(incident) {
    const inc = incident && typeof incident === "object" ? incident : {};
    const n = Number(inc.score ?? inc.correlationScore ?? inc.riskScore);
    return Number.isFinite(n) ? n : 0;
}

export function getSuggestion(incident) {
    const score = incidentScore(incident);
    if (score >= 85) return "true_positive";
    if (score >= 60) return "suspicious";
    return "review";
}

export function getConfidence(incident) {
    const base = incidentScore(incident) || 50;
    const sources = incident?.sources?.length || 1;
    return Math.min(95, Math.round(base + sources * 2));
}

export function getReason(incident) {
    const inc = incident && typeof incident === "object" ? incident : {};
    const ip = inc.ip || inc.sourceIP || "unknown host";
    const raw = Array.isArray(inc.sources) ? inc.sources.filter(Boolean) : [];
    const sources = raw.length ? raw.map((s) => (typeof s === "string" ? s : s?.name || String(s))).join(", ") : "multiple telemetry sources";
    return `Suspicious activity from ${ip} across ${sources}`;
}

function suggestionDisplayLabel(suggestion) {
    if (suggestion === "true_positive") return "True Positive";
    if (suggestion === "false_positive") return "False Positive";
    if (suggestion === "suspicious") return "Suspicious";
    if (suggestion === "review") return "Review";
    return String(suggestion || "Review").replace(/_/g, " ");
}

export default function ClassifyModal({ incident = null, incidentId = "#INC-8842", initialSelected = "tp", onClose, onConfirm }) {
    const [selected, setSelected] = useState(initialSelected);
    const [comment, setComment] = useState("");
    const confirmBusy = useRef(false);

    useEffect(() => {
        setSelected(initialSelected);
    }, [initialSelected]);

    const suggestion = useMemo(() => getSuggestion(incident), [incident]);
    const confidencePct = useMemo(() => getConfidence(incident), [incident]);
    const reasonText = useMemo(() => getReason(incident), [incident]);
    const suggestionLabel = useMemo(() => suggestionDisplayLabel(suggestion), [suggestion]);

    const applySystemLogic = () => {
        if (suggestion === "true_positive") setSelected("tp");
        if (suggestion === "false_positive") setSelected("fp");
    };

    useEffect(() => {
        const esc = (e) => {
            if (e.key === "Escape") onClose?.();
        };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [onClose]);

    return (
        <div
            className="cm-overlay"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose?.();
            }}
            role="presentation"
        >
            <div className="cm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>

                {/* HEADER */}
                <div className="cm-header">
                    <div>
                        <h2>Classify &amp; Close Incident</h2>
                        <p className="cm-incident-id">Incident ID: {incidentId}</p>
                    </div>
                    <button className="cm-close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {/* BODY */}
                <div className="cm-body">

                    {/* SUGGESTION BANNER */}
                    <div className="cm-suggestion">
                        <div className="cm-suggestion-left">
                            <div className="cm-suggestion-title">
                                <Sparkles size={18} color="#2badee" />
                                <span>System Suggestion: {suggestionLabel}</span>
                                <span className="cm-confidence">{confidencePct}% Confidence</span>
                            </div>
                            <p>{reasonText}</p>
                        </div>
                        <button type="button" className="cm-apply-btn" onClick={applySystemLogic}>
                            Apply Logic
                        </button>
                    </div>

                    {/* ANALYST DECISION */}
                    <div className="cm-decision-section">
                        <div className="cm-decision-header">
                            <h3>Analyst Decision</h3>
                            <span>Choose one to proceed</span>
                        </div>
                        <div className="cm-options-grid">
                            {options.map(opt => (
                                <label
                                    key={opt.value}
                                    className={`cm-option ${selected === opt.value ? `cm-option-selected-${opt.color}` : ""}`}
                                >
                                    <input
                                        type="radio"
                                        name="classification"
                                        value={opt.value}
                                        checked={selected === opt.value}
                                        onChange={() => setSelected(opt.value)}
                                    />
                                    {opt.icon}
                                    <span>{opt.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* COMMENT */}
                    <div className="cm-comment-section">
                        <label className="cm-comment-label">Internal Justification (Optional)</label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder="Add notes on your decision or additional evidence found..."
                        />
                        <p className="cm-comment-hint">
                            This comment will be attached to the incident history and used to improve future automated classification.
                        </p>
                    </div>

                </div>

                {/* FOOTER */}
                <div className="cm-footer">
                    <button className="cm-cancel-btn" onClick={onClose}>Cancel</button>
                    <button
                        type="button"
                        className="cm-confirm-btn"
                        onClick={() => {
                            if (confirmBusy.current) return;
                            confirmBusy.current = true;
                            if (typeof onConfirm === "function") {
                                onConfirm({ selected, comment });
                            }
                            onClose?.();
                            confirmBusy.current = false;
                        }}
                    >
                        Confirm &amp; Close Incident
                    </button>
                </div>

            </div>
        </div>
    );
}