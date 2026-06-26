import { useEffect, useState } from "react";
import { Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import { LS_AUTH, LS_USER, LS_ROLE } from "../session";
import { loginUser, verifyUserOtp } from "../api/authService";
import { pushNotification } from "../platformStore";
import { BRAND } from "../brand";
import { SocLogo } from "../components/SocLogo";
import { ensureSocProfileDefaults } from "../socProfile";
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
        ensureSocProfileDefaults();

        // Auto-redirect if already logged in
        if (localStorage.getItem(LS_AUTH) === "true") {
            navigate("/dashboard", { replace: true });
        }

        // Clear any stale MFA/OTP state on login page load to start fresh
        sessionStorage.removeItem("pending_session_id");
        sessionStorage.removeItem(LS_OTP_CREATED_AT);
    }, [navigate]);

    const completeLogin = (responseData) => {
        // Map backend role to frontend roleType safely handling objects
        let rawRoleName = responseData.user?.role?.name || responseData.user?.role?.role || "";
        if (rawRoleName && typeof rawRoleName === "object") {
            rawRoleName = rawRoleName.en || rawRoleName.ar || "";
        }
        const roleStr = String(rawRoleName || "").toLowerCase();
        const roleType = roleStr.includes("admin") 
            ? "admin" 
            : (roleStr.includes("viewer") ? "viewer" : "analyst");

        // Store token and user information
        localStorage.setItem(
            LS_USER,
            JSON.stringify({
                id: String(responseData.user.id),
                name: responseData.user.name,
                email: responseData.user.email,
                roleType: roleType
            })
        );
        localStorage.setItem(LS_AUTH, "true");
        localStorage.setItem(LS_ROLE, roleType);

        // Set the display profile to avoid the default fallback override
        const displayRoleLabel = roleType === "admin" ? "SOC Administrator" : roleType === "viewer" ? "SOC Viewer" : "SOC Analyst";
        localStorage.setItem(
            "soc_user",
            JSON.stringify({
                name: responseData.user.name,
                role: rawRoleName || displayRoleLabel,
                avatar: "",
                email: responseData.user.email,
            })
        );

        if (rememberMe) {
            localStorage.setItem(LS_REMEMBER, "1");
            localStorage.setItem(LS_LAST_EMAIL, email.trim().toLowerCase());
        } else {
            localStorage.removeItem(LS_REMEMBER);
            localStorage.removeItem(LS_LAST_EMAIL);
        }

        // Clean up MFA session
        sessionStorage.removeItem("pending_session_id");
        sessionStorage.removeItem(LS_OTP_CREATED_AT);

        addAuditLog({
            action: AUDIT_ACTIONS.MFA_SUCCESS,
            severity: AUDIT_SEVERITY.INFO,
            user: responseData.user.name,
            message: responseData.token ? `Login successful - Role: ${rawRoleName || displayRoleLabel}` : `MFA verification successful - Role: ${rawRoleName || displayRoleLabel}`,
            entity: "authentication"
        });
        pushNotification(`${responseData.user.name} logged in`);
        window.dispatchEvent(new Event("soc_system_refresh"));
        navigate("/dashboard", { replace: true });
    };

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

        // Clean slate to prevent stale state pollution
        localStorage.removeItem("isAuthToken");
        localStorage.removeItem("isAuth");
        localStorage.removeItem("currentUser");
        localStorage.removeItem("currentRole");
        localStorage.removeItem("soc_user");
        localStorage.removeItem("profile_data");
        localStorage.removeItem("profile_avatar");

        setBusy(true);
        try {
            // Call real backend API
            const responseData = await loginUser(email, password);

            // Direct login check
            if (responseData.token) {
                completeLogin(responseData);
                return;
            }

            // Save the session ID returned by backend
            sessionStorage.setItem("pending_session_id", responseData.session_id);
            sessionStorage.setItem(LS_OTP_CREATED_AT, String(Date.now()));
            
            // In dev mode, the backend returns the OTP code in the response
            if (responseData.otp) {
                console.log(`🔐 MFA OTP for ${email}: ${responseData.otp}`);
                pushNotification(`[DEV] MFA OTP for ${email}: ${responseData.otp}`, { category: "security" });
                Swal.fire({
                    title: 'MFA OTP (Dev Mode)',
                    html: `Your verification code is: <strong style="font-size: 20px; color: #2badee; display: block; margin-top: 10px;">${responseData.otp}</strong>`,
                    icon: 'info',
                    background: '#121f28',
                    color: '#fff',
                    confirmButtonColor: '#2badee'
                });
            } else {
                pushNotification(`MFA verification code sent to ${email}`, { category: "security" });
            }

            setMfaStep(true);
            setOtpInput("");
            setMfaError("");
        } catch (error) {
            setErrors((prev) => ({ ...prev, form: error.message || "Invalid email or password" }));
        } finally {
            setBusy(false);
        }
    };

    const handleForgotPassword = () => {
        Swal.fire({
            title: 'Password Recovery',
            text: 'Password recovery requested. Please contact your SOC Administrator to reset your credentials.',
            icon: 'info',
            background: '#121f28',
            color: '#fff',
            confirmButtonColor: '#2badee'
        });
    };

    const handleMfaVerify = async () => {
        if (!otpInput.trim()) {
            setMfaError("OTP is required");
            return;
        }

        setBusy(true);
        try {
            const sessionId = sessionStorage.getItem("pending_session_id");
            if (!sessionId) {
                setMfaError("Session expired. Please login again.");
                setMfaStep(false);
                return;
            }

            // Verify with real backend
            const responseData = await verifyUserOtp(email, otpInput.trim(), sessionId);
            completeLogin(responseData);
        } catch (error) {
            setMfaError(error.message || "Invalid OTP. Please try again.");
            addAuditLog({
                action: AUDIT_ACTIONS.MFA_FAILURE,
                severity: AUDIT_SEVERITY.SECURITY,
                message: `MFA verification failed - ${error.message}`,
                entity: "authentication"
            });
        } finally {
            setBusy(false);
        }
    };

    const handleMfaCancel = () => {
        sessionStorage.removeItem("pending_session_id");
        sessionStorage.removeItem(LS_OTP_CREATED_AT);
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
