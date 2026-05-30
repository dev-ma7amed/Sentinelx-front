import { apiPost, apiGet, apiPut, setAuthToken, clearAuthToken } from "./client";

/**
 * Log in a user (initiates authentication / triggers OTP if configured)
 * @param {string} email 
 * @param {string} password 
 */
export async function loginUser(email, password) {
    const res = await apiPost("v1/auth/login", { email, password });
    // ApiResponse format: { status, message, data: { session_id, otp } }
    return res.data || res;
}

/**
 * Verify OTP code for a user
 * @param {string} email 
 * @param {string} otp 
 * @param {string} sessionId
 */
export async function verifyUserOtp(email, otp, sessionId) {
    const res = await apiPost("v1/auth/verify-otp", { 
        email, 
        otp, 
        session_id: sessionId 
    });
    
    // ApiResponse format: { status, message, data: { token, user } }
    const responseData = res.data || res;
    if (responseData && responseData.token) {
        setAuthToken(responseData.token);
    }
    return responseData;
}

/**
 * Log out current session
 */
export async function logoutUser() {
    try {
        await apiPost("v1/auth/logout");
    } catch (e) {
        console.warn("Failed server-side logout, clearing local state anyway", e);
    } finally {
        clearAuthToken();
    }
}

/**
 * Fetch authenticated user profile
 */
export async function getProfile() {
    const res = await apiGet("v1/auth/profile");
    return res.data || res;
}

/**
 * Update user profile
 * @param {object} profileData 
 */
export async function updateProfile(profileData) {
    const res = await apiPut("v1/auth/profile", profileData);
    return res.data || res;
}

/**
 * Update user password
 * @param {object} passwordData 
 */
export async function updatePassword(passwordData) {
    const res = await apiPut("v1/auth/password", passwordData);
    return res.data || res;
}
