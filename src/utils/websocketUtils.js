/**
 * WebSocket Utility Module
 * Provides safe WebSocket operations with proper error handling
 */

/**
 * Safe WebSocket send wrapper
 * Prevents crashes from sending on closed/undefined connections
 * @param {WebSocket} ws - WebSocket instance
 * @param {string|object} data - Data to send
 * @returns {boolean} - True if sent successfully, false otherwise
 */
export function safeSend(ws, data) {
    try {
        if (!ws) {
            console.warn("WebSocket not initialized, skipping send");
            return false;
        }

        if (ws.readyState !== WebSocket.OPEN) {
            console.warn(`WebSocket not ready (state: ${ws.readyState}), skipping send`);
            return false;
        }

        const payload = typeof data === "string" ? data : JSON.stringify(data);
        ws.send(payload);
        console.log("WebSocket message sent successfully");
        return true;
    } catch (error) {
        console.error("WS SEND ERROR:", error);
        return false;
    }
}

/**
 * Safe WebSocket close wrapper
 * @param {WebSocket} ws - WebSocket instance
 * @param {number} code - Close code (default 1000)
 * @param {string} reason - Close reason
 */
export function safeClose(ws, code = 1000, reason = "Normal closure") {
    try {
        if (!ws) {
            console.warn("WebSocket not initialized, cannot close");
            return false;
        }

        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close(code, reason);
            console.log("WebSocket closed successfully");
            return true;
        }

        console.warn(`WebSocket already closed (state: ${ws.readyState})`);
        return false;
    } catch (error) {
        console.error("WS CLOSE ERROR:", error);
        return false;
    }
}

/**
 * Check if WebSocket is ready for communication
 * @param {WebSocket} ws - WebSocket instance
 * @returns {boolean} - True if ready, false otherwise
 */
export function isWebSocketReady(ws) {
    return ws && ws.readyState === WebSocket.OPEN;
}

/**
 * Get human-readable WebSocket state
 * @param {number} readyState - WebSocket readyState value
 * @returns {string} - State name
 */
export function getWebSocketStateName(readyState) {
    const states = {
        0: "CONNECTING",
        1: "OPEN",
        2: "CLOSING",
        3: "CLOSED",
    };
    return states[readyState] || "UNKNOWN";
}

/**
 * Create a safe WebSocket connection with error handling
 * @param {string} url - WebSocket URL
 * @param {object} options - Configuration options
 * @returns {Promise<WebSocket>} - Promise resolving to WebSocket instance
 */
export function createSafeWebSocket(url, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket(url);

            ws.onopen = () => {
                console.log("WebSocket connected successfully");
                resolve(ws);
            };

            ws.onerror = (error) => {
                console.error("WebSocket connection error:", error);
                reject(error);
            };

            ws.onclose = () => {
                console.log("WebSocket connection closed");
            };

            // Set timeout for connection
            const timeout = options.timeout || 5000;
            setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    ws.close();
                    reject(new Error("WebSocket connection timeout"));
                }
            }, timeout);
        } catch (error) {
            console.error("Failed to create WebSocket:", error);
            reject(error);
        }
    });
}

export default {
    safeSend,
    safeClose,
    isWebSocketReady,
    getWebSocketStateName,
    createSafeWebSocket,
};
