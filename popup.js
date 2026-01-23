import { tokenEncryption } from './scripts/encryption.js';
import { createTokenHandler } from './scripts/token-handler.js';
import { requestDeviceCode, pollForAccessToken, sleep, ERROR_MESSAGES } from './scripts/oauth.js';

document.addEventListener('DOMContentLoaded', async function () {
    const authPromptElement = document.getElementById('auth-prompt');
    const authPendingElement = document.getElementById('auth-pending');
    const authCompleteElement = document.getElementById('auth-complete');
    const signInButton = document.getElementById('sign-in-btn');
    const signOutButton = document.getElementById('sign-out-btn');
    const cancelAuthButton = document.getElementById('cancel-auth');
    const userCodeElement = document.getElementById('user-code');
    const pendingStatusElement = document.getElementById('pending-status');
    const statusElement = document.getElementById('status');
    const copyCodeButton = document.getElementById('copy-code-btn');

    // Create token handler for popup context.
    const tokenHandler = createTokenHandler(tokenEncryption);

    // Show the appropriate UI based on auth state.
    function showAuthPrompt() {
        authPromptElement.style.display = 'block';
        authPendingElement.style.display = 'none';
        authCompleteElement.style.display = 'none';
    }

    function showAuthPending(userCode) {
        authPromptElement.style.display = 'none';
        authPendingElement.style.display = 'block';
        authCompleteElement.style.display = 'none';
        userCodeElement.textContent = userCode;
        pendingStatusElement.textContent = 'Waiting for authorization...';
    }

    function showAuthComplete() {
        authPromptElement.style.display = 'none';
        authPendingElement.style.display = 'none';
        authCompleteElement.style.display = 'block';
    }

    // Check for pending OAuth flow first (user may have reopened popup).
    const pendingAuth = await chrome.storage.local.get(['oauthPending']);
    if (pendingAuth.oauthPending) {
        const { user_code, expires_at } = pendingAuth.oauthPending;
        if (Date.now() < expires_at) {
            // Still valid - show the pending state with the code.
            showAuthPending(user_code);
            // The background script is handling the polling.
        } else {
            // Expired - clear it.
            await chrome.storage.local.remove('oauthPending');
        }
    }

    // Check if a token is already saved.
    try {
        console.log('Popup: Starting token check...');
        const hasToken = await tokenHandler.hasGitHubToken();
        console.log('Popup: Token check result:', hasToken);

        if (hasToken) {
            console.log('Popup: Token found, showing authenticated state');
            // Clear any pending OAuth state.
            await chrome.storage.local.remove('oauthPending');
            showAuthComplete();
        } else if (!pendingAuth.oauthPending || Date.now() >= pendingAuth.oauthPending?.expires_at) {
            showAuthPrompt();
        }
    } catch (error) {
        console.error("Error loading token:", error);
        showStatus("Error loading token: " + error.message, "error");
        showAuthPrompt();
    }

    // Listen for storage changes (background script completed auth).
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes.githubToken && changes.githubToken.newValue) {
                // Token was added - auth completed!
                showAuthComplete();
                showStatus("Successfully signed in!", "success");
            }
            if (changes.oauthPending && !changes.oauthPending.newValue) {
                // OAuth pending was cleared but no token - might have failed.
                tokenHandler.hasGitHubToken().then(hasToken => {
                    if (!hasToken) {
                        showAuthPrompt();
                    }
                });
            }
        }
    });

    // Sign in button - start OAuth device flow.
    signInButton.addEventListener('click', async function () {
        try {
            signInButton.disabled = true;
            signInButton.textContent = 'Starting...';

            // Step 1: Request device and user codes.
            console.log('OAuth: Requesting device code...');
            const deviceCodeResponse = await requestDeviceCode();
            console.log('OAuth: Got device code response:', deviceCodeResponse);

            const { device_code, user_code, verification_uri, expires_in, interval } = deviceCodeResponse;

            if (!device_code || !user_code) {
                throw new Error(deviceCodeResponse.error_description || deviceCodeResponse.error || 'Invalid response from GitHub');
            }

            // Store the pending auth state so we can recover if popup closes.
            const expiresAt = Date.now() + (expires_in || 900) * 1000;
            await chrome.storage.local.set({
                oauthPending: {
                    device_code,
                    user_code,
                    expires_at: expiresAt,
                    interval: interval || 5
                }
            });

            // Step 2: Show the user code.
            showAuthPending(user_code);

            // Tell background script to start polling (it will persist across popup close).
            chrome.runtime.sendMessage({ type: 'START_OAUTH_POLLING' });

            // Open GitHub device authorization page in new tab.
            chrome.tabs.create({ url: verification_uri || 'https://github.com/login/device' });

        } catch (error) {
            console.error('OAuth error:', error);
            showStatus("Error: " + error.message, "error");
            showAuthPrompt();
        } finally {
            signInButton.disabled = false;
            signInButton.textContent = 'Sign in with GitHub';
        }
    });

    // Copy code button.
    if (copyCodeButton) {
        copyCodeButton.addEventListener('click', async function () {
            const code = userCodeElement.textContent;
            try {
                await navigator.clipboard.writeText(code);
                showStatus("Code copied!", "success");
            } catch (err) {
                showStatus("Failed to copy", "error");
            }
        });
    }

    // Cancel button - abort the polling.
    cancelAuthButton.addEventListener('click', async function () {
        await chrome.storage.local.remove('oauthPending');
        chrome.runtime.sendMessage({ type: 'CANCEL_OAUTH_POLLING' });
        showAuthPrompt();
        showStatus("Authorization cancelled.", "success");
    });

    // Sign out button - clear the token.
    signOutButton.addEventListener('click', async function () {
        try {
            await chrome.storage.local.remove('githubToken');
            showAuthPrompt();
            showStatus("Signed out successfully!", "success");
        } catch (error) {
            showStatus("Error signing out: " + error.message, "error");
        }
    });

    // Helper function to show status messages.
    function showStatus(message, type) {
        statusElement.textContent = message;
        statusElement.className = "status " + type;
        statusElement.style.display = "block";

        // Hide status after 4 seconds.
        setTimeout(() => {
            statusElement.style.display = "none";
        }, 4000);
    }
});
