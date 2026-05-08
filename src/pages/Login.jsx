import { useEffect, useState } from "react";
import { Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ensureSocUsers, readSocUsers, tryLogin, writeSocUsers, LS_AUTH, LS_USER, LS_ROLE } from "../session";
import { pushAudit, pushNotification } from "../platformStore";
import { BRAND } from "../brand";
import { SocLogo } from "../components/SocLogo";
import { ensureSocProfileDefaults } from "../socProfile";
import { mockUsers } from "../data/mockUsers";
import { addAuditLog, AUDIT_ACTIONS, AUDIT_SEVERITY } from "../services/auditLogger";
import "../styles/Login.css";
import "../styles/socLayout.css";

const LS_REMEMBER = "soc_remember_me";
const LS_LAST_EMAIL = "soc_last_login_email";
const LS_PENDING_OTP = "pending_otp";
const LS_OTP_CREATED_AT = "otp_created_at";
const LS_PENDING_USER = "pending_user";
const OTP_EXPIRY_MS = 5 * 60 * 1000;

export default function Login() {
    const [errors, setErrors] = useState({});
    const [showPass, setShowPass] = useState(false);
    const [email, setEmail] = useState(() => {
        try {
            if (localStorage.getItem(LS_REMEMBER) === "1") {
                return localStorage.getItem(LS_LAST_EMAIL) || "";
            }
        } catch {
            /* ignore */
        }
        return "";
    });
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(() => {
        try {
            return localStorage.getItem(LS_REMEMBER) === "1";
        } catch {
            return false;
        }
    });
    const [busy, setBusy] = useState(false);
    const [mfaStep, setMfaStep] = useState(false);
    const [otpInput, setOtpInput] = useState("");
    const [mfaError, setMfaError] = useState("");
    const navigate = useNavigate();

    useEffect(() => {
        ensureSocUsers();
        ensureSocProfileDefaults();

        // Auto-redirect if already logged in
        if (localStorage.getItem(LS_AUTH) === "true") {
            navigate("/dashboard", { replace: true });
        }

        // Check if MFA is pending
        const pendingUser = localStorage.getItem(LS_PENDING_USER);
        if (pendingUser) {
            setMfaStep(true);
        }
    }, [navigate]);

    const handleLogin = async () => {
        const newErrors = {};

        if (!email.trim()) {
            newErrors.email = "Work email is required";
        } else if (!/\S+@\S+\.\S+/.test(email)) {
            newErrors.email = "Enter a valid email address";
        }

        if (!password.trim()) {
            newErrors.password = "Password is required";
        } else if (password.length < 6) {
            newErrors.password = "Password must be at least 6 characters";
        }

        setErrors(newErrors);

        if (Object.keys(newErrors).length > 0) return;

        setBusy(true);
        try {
            await new Promise((r) => { window.setTimeout(r, 220); });

            // Validate against mock users
            const matchedUser = mockUsers.find(
                u => u.email === email && u.password === password
            );

            if (!matchedUser) {
                setErrors((prev) => ({ ...prev, form: "Invalid email or password" }));
                return;
            }

            // Generate OTP for MFA
            const otp = Math.floor(100000 + Math.random() * 900000);
            try {
                sessionStorage.setItem(LS_PENDING_OTP, String(otp));
                sessionStorage.setItem(LS_OTP_CREATED_AT, String(Date.now()));
                localStorage.setItem(LS_PENDING_USER, JSON.stringify({
                    id: String(matchedUser.id),
                    name: matchedUser.name,
                    email: matchedUser.email,
                    role: matchedUser.role
                }));
            } catch {
                /* ignore */
            }

            // Show OTP in console for demo (in production, would be sent via email/SMS)
            console.log(`🔐 MFA OTP for ${matchedUser.email}: ${otp}`);
            pushNotification(`MFA OTP sent to ${matchedUser.email}`, { category: "security" });

            setMfaStep(true);
            setOtpInput("");
            setMfaError("");
        } finally {
            setBusy(false);
        }
    };

    const handleForgotPassword = () => {
        ensureSocUsers();
        const emailInput = window.prompt("Enter your work email");
        if (!emailInput) return;
        const emailLc = emailInput.trim().toLowerCase();
        const users = readSocUsers() || [];
        const user = users.find((u) => (u.email || "").trim().toLowerCase() === emailLc);
        if (!user) {
            window.alert("Email not found.");
            return;
        }
        const code = String(Math.floor(100000 + Math.random() * 900000));
        localStorage.setItem("reset_code", code);
        localStorage.setItem("reset_email", emailLc);
        window.alert(`Reset code sent to ${emailInput} (simulated): ${code}`);
        const enteredCode = window.prompt("Enter the 6-digit reset code");
        if (!enteredCode) return;
        const newPassword = window.prompt("Enter your new password");
        if (!newPassword) return;
        const storedCode = localStorage.getItem("reset_code");
        const storedEmail = localStorage.getItem("reset_email");
        if (enteredCode.trim() !== storedCode || storedEmail !== emailLc) {
            window.alert("Invalid reset code.");
            return;
        }
        const updated = users.map((u) => (u.id === user.id ? { ...u, password: newPassword } : u));
        writeSocUsers(updated);
        localStorage.removeItem("reset_code");
        localStorage.removeItem("reset_email");
        pushAudit({ action: "password_reset", entityType: "user", entityId: emailLc, message: "Password reset (simulated)" });
        pushNotification(`Password reset for ${emailLc}`);
        window.alert("Password updated successfully.");
    };

    const handleMfaVerify = async () => {
        if (!otpInput.trim()) {
            setMfaError("OTP is required");
            return;
        }

        setBusy(true);
        try {
            await new Promise((r) => { window.setTimeout(r, 220); });

            // Check OTP expiry
            const createdAt = parseInt(sessionStorage.getItem(LS_OTP_CREATED_AT) || "0", 10);
            if (Date.now() - createdAt > OTP_EXPIRY_MS) {
                setMfaError("OTP expired. Please login again.");
                sessionStorage.removeItem(LS_PENDING_OTP);
                sessionStorage.removeItem(LS_OTP_CREATED_AT);
                localStorage.removeItem(LS_PENDING_USER);
                setMfaStep(false);
                setOtpInput("");
                addAuditLog({
                    action: AUDIT_ACTIONS.MFA_FAILURE,
                    severity: AUDIT_SEVERITY.SECURITY,
                    message: "MFA verification failed - OTP expired",
                    entity: "authentication"
                });
                return;
            }

            // Verify OTP
            const storedOtp = sessionStorage.getItem(LS_PENDING_OTP);
            if (otpInput.trim() !== storedOtp) {
                setMfaError("Invalid OTP. Please try again.");
                addAuditLog({
                    action: AUDIT_ACTIONS.MFA_FAILURE,
                    severity: AUDIT_SEVERITY.SECURITY,
                    message: "MFA verification failed - Invalid OTP",
                    entity: "authentication"
                });
                return;
            }

            // OTP verified - complete login
            const pendingUserStr = localStorage.getItem(LS_PENDING_USER);
            if (!pendingUserStr) {
                setMfaError("Session expired. Please login again.");
                return;
            }

            const pendingUser = JSON.parse(pendingUserStr);

            // Map role to roleType for compatibility
            const roleTypeMap = {
                "Administrator": "admin",
                "SOC Analyst": "analyst",
                "Viewer": "viewer"
            };

            // Store user info with correct keys
            try {
                localStorage.setItem(
                    LS_USER,
                    JSON.stringify({
                        id: String(pendingUser.id),
                        name: pendingUser.name,
                        email: pendingUser.email,
                        roleType: roleTypeMap[pendingUser.role] || "analyst"
                    })
                );
                localStorage.setItem(LS_AUTH, "true");
                localStorage.setItem(LS_ROLE, roleTypeMap[pendingUser.role] || "analyst");

                if (rememberMe) {
                    localStorage.setItem(LS_REMEMBER, "1");
                    localStorage.setItem(LS_LAST_EMAIL, pendingUser.email.trim().toLowerCase());
                } else {
                    localStorage.removeItem(LS_REMEMBER);
                    localStorage.removeItem(LS_LAST_EMAIL);
                }
            } catch {
                /* ignore */
            }

            // Clean up MFA session
            sessionStorage.removeItem(LS_PENDING_OTP);
            sessionStorage.removeItem(LS_OTP_CREATED_AT);
            localStorage.removeItem(LS_PENDING_USER);

            addAuditLog({
                action: AUDIT_ACTIONS.MFA_SUCCESS,
                severity: AUDIT_SEVERITY.INFO,
                user: pendingUser.name,
                message: `MFA verification successful - Role: ${pendingUser.role}`,
                entity: "authentication"
            });
            pushNotification(`${pendingUser.name} logged in with MFA`);
            window.dispatchEvent(new Event("soc_system_refresh"));
            navigate("/dashboard", { replace: true });
        } finally {
            setBusy(false);
        }
    };

    const handleMfaCancel = () => {
        sessionStorage.removeItem(LS_PENDING_OTP);
        sessionStorage.removeItem(LS_OTP_CREATED_AT);
        localStorage.removeItem(LS_PENDING_USER);
        setMfaStep(false);
        setOtpInput("");
        setMfaError("");
        setEmail("");
        setPassword("");
    };

    return (
        <div className="app">

            {/* ===== Header ===== */}
            <header className="header soc-topbar">
                <SocLogo isLoginPage={true} />
                <div className="header-right">
                    <span className="system-status">
                        System Status: <span className="status-green">Operational</span>
                    </span>

                    <button className="help-btn">Help Desk</button>



                </div>
            </header>



            {/* ===== Center Card ===== */}
            <main className="center">
                <div className="cardlog">

                    <div className="title">
                        <img src="/logo.png" alt="SentinelX" className="login-hero-logo" />
                        <h2>SENTINELX</h2>
                        <p className="login-brand-tagline">{BRAND.tagline}</p>
                    </div>

                    {!mfaStep ? (
                        <>
                            <label>Email</label>
                            <div className={`input-icon ${errors.email ? "error" : ""}`}>
                                <Mail size={18} className="icon" />

                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="analyst@company.com"
                                />
                            </div>

                            {errors.email && (
                                <div className="error-text">{errors.email}</div>
                            )}



                            <div className="password-row">
                                <label>Password</label>
                                <span className="forgot" onClick={handleForgotPassword}>Forgot password?</span>
                            </div>

                            <div className={`input-icon password-wrapper ${errors.password ? "error" : ""}`}>
                                <Lock size={18} className="icon" />

                                <input
                                    type={showPass ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                />

                                <button
                                    type="button"
                                    className="eye-btn"
                                    onClick={() => setShowPass(!showPass)}
                                >
                                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>

                            {errors.password && (
                                <div className="error-text">{errors.password}</div>
                            )}

                            {errors.form && (
                                <div className="error-text">{errors.form}</div>
                            )}

                            <div className="checkbox">
                                <input
                                    id="soc-login-remember"
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                />
                                <label htmlFor="soc-login-remember">Remember me</label>
                            </div>

                            <button type="button" className="login-btn" onClick={handleLogin} disabled={busy}>
                                {busy ? (
                                    <>
                                        <Loader2 size={18} className="login-btn-spinner" aria-hidden />
                                        Signing in…
                                    </>
                                ) : (
                                    "Login"
                                )}
                            </button>
                        </>
                    ) : (
                        <>
                            <label style={{ marginTop: "16px" }}>Multi-Factor Authentication</label>
                            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                                Enter the 6-digit OTP sent to your email
                            </p>

                            <div className={`input-icon ${mfaError ? "error" : ""}`}>
                                <Lock size={18} className="icon" />
                                <input
                                    type="text"
                                    value={otpInput}
                                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                    placeholder="000000"
                                    maxLength="6"
                                    autoFocus
                                />
                            </div>

                            {mfaError && (
                                <div className="error-text">{mfaError}</div>
                            )}

                            <button type="button" className="login-btn" onClick={handleMfaVerify} disabled={busy || otpInput.length !== 6}>
                                {busy ? (
                                    <>
                                        <Loader2 size={18} className="login-btn-spinner" aria-hidden />
                                        Verifying…
                                    </>
                                ) : (
                                    "Verify OTP"
                                )}
                            </button>

                            <button
                                type="button"
                                style={{
                                    width: "100%",
                                    marginTop: "8px",
                                    background: "transparent",
                                    color: "var(--accent-blue)",
                                    border: "1px solid var(--accent-blue)",
                                    padding: "12px",
                                    borderRadius: "8px",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    fontWeight: "600"
                                }}
                                onClick={handleMfaCancel}
                                disabled={busy}
                            >
                                Back to Login
                            </button>
                        </>
                    )}


                    <div className="security-box">
                        <div className="security-badge">
                            🔴 AUTHORIZED SOC PERSONNEL ONLY
                        </div>

                        <p className="security-text">
                            Accessing the system requires valid security credentials.<br />
                            All activities are monitored and logged.
                        </p>
                    </div>

                </div>
            </main>


            <footer className="footer">
                <div className="footer-left">
                    © 2026 Sentinel X. Internal Enterprise Tool.
                </div>

                <div className="footer-right">
                    <a href="#">Privacy Policy</a>
                    <a href="#">Security Terms</a>
                    <a href="#">Compliance Documentation</a>
                </div>
            </footer>

        </div>
    );
}
