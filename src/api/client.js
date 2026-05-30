/**
 * SentinelX API Client
 * Centralizes the BASE_URL and authentication headers for all frontend requests.
 */

// Default Base URL as requested by the user
export const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://sentinelx.test/api/";

/**
 * Get active auth token from localStorage
 * @returns {string|null}
 */
export function getAuthToken() {
    return localStorage.getItem("isAuthToken");
}

/**
 * Set active auth token in localStorage
 * @param {string} token 
 */
export function setAuthToken(token) {
    if (token) {
        localStorage.setItem("isAuthToken", token);
        localStorage.setItem("isAuth", "true");
    } else {
        clearAuthToken();
    }
}

/**
 * Clear active auth token from localStorage
 */
export function clearAuthToken() {
    localStorage.removeItem("isAuthToken");
    localStorage.removeItem("isAuth");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("currentRole");
}

import Swal from "sweetalert2";

// Configure beautiful SweetAlert2 corner toast notification
const Toast = Swal.mixin({
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 4000,
    timerProgressBar: true,
    background: "#1e1e2d",
    color: "#ffffff",
    customClass: {
        popup: "swal2-toast-dark-custom"
    },
    didOpen: (toast) => {
        toast.addEventListener("mouseenter", Swal.stopTimer);
        toast.addEventListener("mouseleave", Swal.resumeTimer);
    }
});

/**
 * Unified request utility
 * @param {string} endpoint - API endpoint (e.g. 'v1/alerts')
 * @param {RequestInit} [options] - Fetch options
 */
export async function api(endpoint, options = {}) {
    // Clean up slash at the start of endpoint and end of BASE_URL to ensure exactly one slash
    const cleanBase = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    const url = `${cleanBase}${cleanEndpoint}`;

    const token = getAuthToken();
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    };

    const fetchOptions = {
        ...options,
        headers,
    };

    try {
        const response = await fetch(url, fetchOptions);

        // Handle unauthorized (expired/invalid token)
        if (response.status === 401) {
            clearAuthToken();
            window.dispatchEvent(new Event("soc_auth_expired"));
            throw new Error("Session expired. Please log in again.");
        }

        // Return empty body or status code for No Content responses
        if (response.status === 204) {
            return { success: true };
        }

        const data = await response.json();

        if (!response.ok) {
            const errorMsg = data.message || `Request failed with status ${response.status}`;
            Toast.fire({
                icon: "error",
                title: errorMsg
            });
            throw new Error(errorMsg);
        }

        return data;
    } catch (error) {
        console.error(`API Error [${options.method || "GET"} ${endpoint}]:`, error);
        if (error.message && !error.message.includes("Session expired") && !error.message.includes("failed with status")) {
            Toast.fire({
                icon: "error",
                title: error.message || "Network connection error"
            });
        }
        throw error;
    }
}

export const apiGet = (endpoint) => api(endpoint, { method: "GET" });
export const apiPost = (endpoint, body) => api(endpoint, { method: "POST", body: JSON.stringify(body) });
export const apiPut = (endpoint, body) => api(endpoint, { method: "PUT", body: JSON.stringify(body) });
export const apiPatch = (endpoint, body) => api(endpoint, { method: "PATCH", body: JSON.stringify(body) });
export const apiDelete = (endpoint) => api(endpoint, { method: "DELETE" });
