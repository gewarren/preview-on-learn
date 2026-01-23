// Background script to handle token operations from content scripts.
import { createTokenHandler, TOKEN_MESSAGES } from './scripts/token-handler.js';
import { tokenEncryption } from './scripts/encryption.js';
import { pollForAccessToken, sleep } from './scripts/oauth.js';

// Create token handler with encryption for background context.
const tokenHandler = createTokenHandler(tokenEncryption);

// Track OAuth polling state.
let isPollingOAuth = false;

// Start OAuth polling (runs in background, persists when popup closes).
async function startOAuthPolling() {
    if (isPollingOAuth) {
        console.log('OAuth: Already polling, ignoring duplicate request');
        return;
    }

    const stored = await chrome.storage.local.get(['oauthPending']);
    if (!stored.oauthPending) {
        console.log('OAuth: No pending auth found');
        return;
    }

    const { device_code, expires_at, interval } = stored.oauthPending;
    if (Date.now() >= expires_at) {
        console.log('OAuth: Pending auth has expired');
        await chrome.storage.local.remove('oauthPending');
        return;
    }

    isPollingOAuth = true;
    let pollInterval = interval || 5;

    console.log('OAuth: Background polling started');

    while (isPollingOAuth && Date.now() < expires_at) {
        await sleep(pollInterval * 1000);

        // Check if polling was cancelled.
        const checkStored = await chrome.storage.local.get(['oauthPending']);
        if (!checkStored.oauthPending) {
            console.log('OAuth: Polling cancelled (no pending auth)');
            break;
        }

        if (!isPollingOAuth) {
            console.log('OAuth: Polling cancelled');
            break;
        }

        console.log('OAuth: Background polling for access token...');
        try {
            const tokenResponse = await pollForAccessToken(device_code);
            console.log('OAuth: Poll response:', tokenResponse);

            if (tokenResponse.access_token) {
                // Success! Encrypt and store the token.
                console.log('OAuth: Got access token, storing...');
                const encryptedToken = await tokenEncryption.encryptToken(tokenResponse.access_token);
                await chrome.storage.local.set({ githubToken: encryptedToken });
                await chrome.storage.local.remove('oauthPending');
                isPollingOAuth = false;
                console.log('OAuth: Successfully authenticated!');
                return;
            } else if (tokenResponse.error === 'slow_down') {
                // GitHub is asking us to slow down.
                pollInterval = tokenResponse.interval || pollInterval + 5;
                console.log('OAuth: Slowing down, new interval:', pollInterval);
            } else if (tokenResponse.error === 'authorization_pending') {
                // Still waiting for user - this is normal.
                console.log('OAuth: Still waiting for user authorization...');
            } else if (tokenResponse.error) {
                // Some other error occurred.
                console.error('OAuth: Error:', tokenResponse.error);
                await chrome.storage.local.remove('oauthPending');
                isPollingOAuth = false;
                return;
            }
        } catch (error) {
            console.error('OAuth: Polling error:', error);
            // Continue polling on network errors.
        }
    }

    isPollingOAuth = false;
    console.log('OAuth: Polling ended');
}

// Handle messages from content scripts and popup.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === TOKEN_MESSAGES.CHECK_TOKEN) {
        tokenHandler.hasGitHubToken().then(hasToken => {
            sendResponse({ hasToken });
        }).catch(error => {
            console.error('Error checking token:', error);
            sendResponse({ hasToken: false });
        });
        return true; // Will respond asynchronously.
    }

    if (request.type === TOKEN_MESSAGES.GET_TOKEN) {
        tokenHandler.getGitHubToken().then(token => {
            sendResponse({ token });
        }).catch(error => {
            console.error('Error getting token:', error);
            sendResponse({ token: null });
        });
        return true; // Will respond asynchronously.
    }

    if (request.type === 'START_OAUTH_POLLING') {
        startOAuthPolling();
        sendResponse({ started: true });
        return false;
    }

    if (request.type === 'CANCEL_OAUTH_POLLING') {
        isPollingOAuth = false;
        sendResponse({ cancelled: true });
        return false;
    }
});
