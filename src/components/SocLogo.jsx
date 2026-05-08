import { useState } from "react";
import { Link } from "react-router-dom";
import { Shield } from "lucide-react";
import { BRAND } from "../brand";
import "../styles/SocLogo.css";

const LOGO_PUBLIC = "/logo.png";

export function SocLogo({ className = "", to = "/dashboard", showText = true, isLoginPage = false }) {
    const [imgOk, setImgOk] = useState(true);

    return (
        <Link to={to} className={`soc-logo-link ${className}`.trim()} title={`${BRAND.name} — Home`}>
            <span className="soc-logo-mark">
                {imgOk ? (
                    <img
                        src={LOGO_PUBLIC}
                        alt=""
                        className="soc-logo-img h-8 w-auto"
                        height={32}
                        onError={() => setImgOk(false)}
                    />
                ) : (
                    <span className="soc-logo-fallback" aria-hidden>
                        <Shield size={24} className="soc-logo-icon" />
                    </span>
                )}
            </span>
            {showText ? (
                <div className="soc-logo-text">
                    <span className="soc-logo-title">{BRAND.name}</span>
                    {isLoginPage && <span className="soc-logo-tagline">{BRAND.tagline}</span>}
                </div>
            ) : null}
        </Link>
    );
}

