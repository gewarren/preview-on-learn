document.addEventListener('DOMContentLoaded', async function () {
    const authStatusElement = document.getElementById('auth-status');
    const authIndicatorElement = document.getElementById('auth-indicator');
    const userInfoElement = document.getElementById('user-info');
    const notAuthenticatedElement = document.getElementById('not-authenticated');
    const authenticatedElement = document.getElementById('authenticated');
    const signInButton = document.getElementById('sign-in-btn');
    const signOutButton = document.getElementById('sign-out-btn');
    const statusElement = document.getElementById('status');

    // Check authentication status on load
    await checkAuthStatus();

    // Sign out button handler
    signOutButton.addEventListener('click', async function () {
        try {
            // Clear the stored access token
            await chrome.storage.sync.remove(['githubAccessToken']);

            showStatus("Successfully signed out", "success");
            await checkAuthStatus();

            // Notify content script that authentication was cleared
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "authCleared" });
            }

        } catch (error) {
            console.error("Sign out error:", error);
            showStatus("Sign out failed: " + error.message, "error");
        }
    });

    // Check authentication status
    async function checkAuthStatus() {
        try {
            // Check if we have an access token stored
            const result = await chrome.storage.sync.get(['githubAccessToken']);
            const authenticated = !!result.githubAccessToken;

            if (authenticated) {
                // Try to get user info
                try {
                    const response = await fetch('https://api.github.com/user', {
                        headers: {
                            'Authorization': `token ${result.githubAccessToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    if (response.ok) {
                        const user = await response.json();

                        authIndicatorElement.textContent = 'Signed in';
                        authIndicatorElement.className = 'auth-indicator authenticated';
                        userInfoElement.textContent = `as ${user.login}`;
                        userInfoElement.style.display = 'block';

                        notAuthenticatedElement.style.display = 'none';
                        authenticatedElement.style.display = 'block';
                    } else {
                        throw new Error('Token validation failed');
                    }
                } catch (error) {
                    console.warn("Could not get user info:", error);

                    // Token might be invalid, clear it
                    await chrome.storage.sync.remove(['githubAccessToken']);

                    authIndicatorElement.textContent = 'Not signed in';
                    authIndicatorElement.className = 'auth-indicator not-authenticated';
                    userInfoElement.style.display = 'none';

                    notAuthenticatedElement.style.display = 'block';
                    authenticatedElement.style.display = 'none';
                }
            } else {
                authIndicatorElement.textContent = 'Not signed in';
                authIndicatorElement.className = 'auth-indicator not-authenticated';
                userInfoElement.style.display = 'none';

                // Show PAT creation interface immediately instead of sign-in button
                showPATCreationInterface();
                notAuthenticatedElement.style.display = 'block';
                authenticatedElement.style.display = 'none';
            }
        } catch (error) {
            console.error("Error checking auth status:", error);
            authIndicatorElement.textContent = 'Error';
            authIndicatorElement.className = 'auth-indicator not-authenticated';
            userInfoElement.style.display = 'none';

            // Show PAT creation interface immediately instead of sign-in button
            showPATCreationInterface();
            notAuthenticatedElement.style.display = 'block';
            authenticatedElement.style.display = 'none';
        }
    }

    // Show PAT creation interface immediately
    function showPATCreationInterface() {
        // Create the GitHub Personal Access Token URL with pre-filled settings
        const tokenUrl = 'https://github.com/settings/tokens/new?' +
            'scopes=repo&' +
            'description=Preview%20on%20Learn%20Extension';

        // Update the popup to show clear instructions with a link
        document.querySelector('.not-authenticated').innerHTML = `
            <div id="token-instructions" style="padding: 15px; background: #f8f9fa; border-radius: 8px; margin-bottom: 15px;">
                <div style="background: #fff3cd; color: #333; padding: 12px; border-radius: 4px; margin-bottom: 15px; border-left: 4px solid #ffc107;">
                    ⚠️ Important: This popup will close when you click the link below.
                    After creating and copying your token, select the extension icon again to paste it in.
                </div>

                <div style="background: #a6d3afff; padding: 12px; border-radius: 4px; border-left: 4px solid #28a745; margin-bottom: 15px; color: #2d5a2d;">
                    Step 1: Select the link below to create a GitHub token.<br>
                    Step 2: Generate the token, then configure it for SSO.<br>
                    Step 3: Copy the token.<br>
                    Step 4: Return here and paste the token.
                </div>

                <a href="${tokenUrl}" target="_blank" style="display: block; width: 90%; padding: 12px; background: #0366d6; color: white; text-decoration: none; border-radius: 4px; text-align: center; font-weight: bold; margin-bottom: 15px;">
                    🔗 Create GitHub token
                </a>

                <div style="margin: 15px 0;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold;">Paste your GitHub token here:</label>
                    <input type="password" id="token-input" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                           style="width: 95%; padding: 8px; border: 1px solid #d1d5da; border-radius: 4px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 12px;">
                </div>
                <button id="save-token-btn" style="width: 100%; padding: 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    💾 Save token and sign in
                </button>

                <div style="margin-top: 10px; padding: 8px; background: #e1f5fe; border-radius: 4px; font-size: 11px; color: #01579b;">
                    <strong>Token Permissions Needed:</strong> The link above pre-selects "repo" scope which is required for this extension to work.
                </div>
            </div>
        `;

        // Handle token submission
        const tokenInput = document.getElementById('token-input');
        const saveTokenBtn = document.getElementById('save-token-btn');

        saveTokenBtn.addEventListener('click', async function () {
            const token = tokenInput.value.trim();

            if (!token) {
                showStatus("Please paste your GitHub token first", "error");
                tokenInput.focus();
                return;
            }

            if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
                showStatus("Token should start with 'ghp_' or 'github_pat_'. Please check your token.", "error");
                tokenInput.focus();
                return;
            }

            saveTokenBtn.disabled = true;
            saveTokenBtn.textContent = '🔄 Validating token...';

            try {
                // Validate the token
                const response = await fetch('https://api.github.com/user', {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        throw new Error('Invalid token. Please check that you copied it correctly.');
                    }
                    if (response.status === 403) {
                        throw new Error('Token does not have required permissions. Please ensure "repo" scope is selected and that you configured it for SSO.');
                    }
                    throw new Error(`Token validation failed (${response.status}). Please try creating a new token.`);
                }

                const user = await response.json();
                console.log(`Token validated successfully for user: ${user.login}`);

                // Store the token
                await chrome.storage.sync.set({ githubAccessToken: token });

                showStatus("✅ Successfully signed in to GitHub!", "success");
                await checkAuthStatus();

                // Notify content script
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "authCompleted" });
                }

            } catch (error) {
                console.error("Token validation error:", error);
                showStatus("❌ " + error.message, "error");
                saveTokenBtn.disabled = false;
                saveTokenBtn.textContent = '💾 Save token and sign in';
                tokenInput.focus();
            }
        });

        // Allow Enter key to submit
        tokenInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                saveTokenBtn.click();
            }
        });

        // Focus the input field
        setTimeout(() => {
            tokenInput.focus();
        }, 100);
    }

    // Show status message
    function showStatus(message, type) {
        statusElement.textContent = message;
        statusElement.className = `status ${type}`;
        statusElement.style.display = 'block';

        // Hide status after 5 seconds
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 5000);
    }
});
