// Saves GitHub token.
async function saveGitHubToken(token) {
    try {
        if (!token || typeof token !== 'string' || token.trim() === '') {
            console.error("Invalid GitHub token");
            return false;
        }

        // Trim any whitespace.
        token = token.trim();

        await chrome.storage.sync.set({ githubToken: token });
        console.log("GitHub token saved");

        // Re-initialize Octokit with the new token.
        await initializeOctokit();

        return true;
    } catch (error) {
        console.error("Error saving GitHub token:", error);
        return false;
    }
}

// Listens for messages from popup.
chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        if (request.action === "refreshOctokit") {
            initializeOctokit();
            sendResponse({ status: "Octokit refreshed" });
        } else if (request.action === "checkSamlStatus") {
            // Check if the token has proper SAML authorization.
            checkSamlAuthorization()
                .then(samlStatus => {
                    sendResponse({ samlStatus });
                })
                .catch(error => {
                    console.error("Error checking SAML status:", error);
                    sendResponse({ error: error.message });
                });
            return true; // Indicates we'll respond asynchronously.
        }
        return true;
    }
);

// Checks SAML authorization status.
async function checkSamlAuthorization() {
    try {
        // Get token from Chrome storage.
        const result = await chrome.storage.sync.get(['githubToken']);
        const token = result.githubToken;

        if (!token) {
            return { authorized: false, reason: "No token" };
        }

        // Make a simple API call to check for SAML headers.
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${token}`
            }
        });

        // Check for SAML-related headers.
        const samlHeader = response.headers.get('x-github-sso');

        if (samlHeader) {
            return {
                authorized: false,
                reason: "SAML SSO authorization required",
                message: "Your token needs to be authorized for SAML SSO organizations."
            };
        }

        return { authorized: true };
    } catch (error) {
        console.error("Error checking SAML authorization:", error);
        return { authorized: false, reason: "Error", message: error.message };
    }
}

// Shows a notification when user needs to add a GitHub token.
function showNoTokenNotification() {
    let notificationContainer = document.getElementById('preview-on-learn-notification');
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.id = 'preview-on-learn-notification';
        notificationContainer.style.position = 'fixed';
        notificationContainer.style.top = '20px';
        notificationContainer.style.right = '20px';
        notificationContainer.style.zIndex = '9999';
        document.body.appendChild(notificationContainer);
    }

    // Create notification element.
    const notification = document.createElement('div');
    notification.style.backgroundColor = '#f8d7da';
    notification.style.color = '#721c24';
    notification.style.padding = '12px 20px';
    notification.style.marginBottom = '10px';
    notification.style.borderRadius = '4px';
    notification.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    notification.style.display = 'flex';
    notification.style.alignItems = 'center';
    notification.style.justifyContent = 'space-between';
    notification.style.width = '350px';
    notification.style.maxWidth = '100%';

    // Add icon and message.
    notification.innerHTML = `
    <div style="display: flex; align-items: center;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" style="margin-right: 10px;" viewBox="0 0 16 16">
        <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
      </svg>
      <div>
        <strong>GitHub Token Required for Private Repository</strong>
        <p style="margin: 5px 0 0;">The Preview on Learn extension needs a PAT to function in private repos. Select Extensions > Preview on Learn to add a GitHub token that's configured for SSO.</p>
      </div>
    </div>
    <button id="close-preview-notification" style="background: none; border: none; color: #721c24; cursor: pointer; font-size: 16px; margin-left: 10px;">×</button>
  `;

    // Add to container.
    notificationContainer.appendChild(notification);

    // Add close button functionality.
    const closeButton = notification.querySelector('#close-preview-notification');
    closeButton.addEventListener('click', () => {
        notification.remove();
    });

    // Auto-remove after 10 seconds.
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 10000);
}
