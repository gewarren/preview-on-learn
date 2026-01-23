// GitHub OAuth Device Code Flow implementation
// See: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

const CLIENT_ID = 'Ov23li5DGq8jIYWnSyec';
const SCOPES = 'repo';

// Step 1: Request device and user verification codes from GitHub
export async function requestDeviceCode() {
    const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            scope: SCOPES
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to request device code: ${response.status}`);
    }

    return response.json();
    // Returns: { device_code, user_code, verification_uri, expires_in, interval }
}

// Step 3: Poll for access token after user authorizes
export async function pollForAccessToken(deviceCode) {
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to poll for token: ${response.status}`);
    }

    return response.json();
    // Success: { access_token, token_type, scope }
    // Pending: { error: 'authorization_pending' }
    // Slow down: { error: 'slow_down', interval: <new_interval> }
    // Expired: { error: 'expired_token' }
    // Denied: { error: 'access_denied' }
}

// Helper to wait for a specified number of milliseconds
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Error messages for user display
export const ERROR_MESSAGES = {
    'authorization_pending': 'Waiting for you to authorize...',
    'slow_down': 'Slowing down polling rate...',
    'expired_token': 'The authorization code has expired. Please try again.',
    'access_denied': 'Authorization was denied. Please try again.',
    'incorrect_client_credentials': 'Configuration error. Please contact support.',
    'incorrect_device_code': 'Invalid device code. Please try again.',
    'device_flow_disabled': 'Device flow is not enabled for this app.'
};
