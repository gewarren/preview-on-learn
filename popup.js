document.addEventListener('DOMContentLoaded', async function () {
    const tokenStatusElement = document.getElementById('token-status');
    const tokenFormElement = document.getElementById('token-form');
    const tokenInput = document.getElementById('github-token');
    const saveTokenButton = document.getElementById('save-token');
    const clearTokenButton = document.getElementById('clear-token');
    const statusElement = document.getElementById('status');

    // Check if a token is already saved.
    try {
        const result = await chrome.storage.sync.get(['githubToken']);
        if (result.githubToken) {
            // Token exists - show the token status and hide the form.
            tokenStatusElement.style.display = 'flex';
            tokenFormElement.style.display = 'none';
            // Don't show the token value for security.
            tokenInput.value = '';
        } else {
            // No token - show the form and hide the token status.
            tokenStatusElement.style.display = 'none';
            tokenFormElement.style.display = 'block';
        }
    } catch (error) {
        console.error("Error loading token:", error);
        showStatus("Error loading token: " + error.message, "error");
    }

    // Save token when button is clicked.
    saveTokenButton.addEventListener('click', async function () {
        const token = tokenInput.value.trim();

        if (!token) {
            showStatus("Please enter a valid token", "error");
            return;
        }

        try {
            await chrome.storage.sync.set({ githubToken: token });

            showStatus("Token saved successfully!", "success");

            // Show the token status and hide the form.
            tokenStatusElement.style.display = 'flex';
            tokenFormElement.style.display = 'none';
            tokenInput.value = '';

            // Send message to content script to refresh Octokit.
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "refreshOctokit" });
                }
            });
        } catch (error) {
            showStatus("Error saving token: " + error.message, "error");
        }
    });

    // Clear token when button is clicked.
    clearTokenButton.addEventListener('click', async function () {
        try {
            await chrome.storage.sync.remove('githubToken');

            // Hide the token status and show the form.
            tokenStatusElement.style.display = 'none';
            tokenFormElement.style.display = 'block';
            tokenInput.value = '';

            showStatus("Token removed successfully!", "success");

            // Send message to content script to refresh Octokit.
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "refreshOctokit" });
                }
            });
        } catch (error) {
            showStatus("Error removing token: " + error.message, "error");
        }
    });

    // Helper function to show status messages.
    function showStatus(message, type) {
        statusElement.textContent = message;
        statusElement.className = "status " + type;
        statusElement.style.display = "block";

        // Hide status after 3 seconds.
        setTimeout(() => {
            statusElement.style.display = "none";
        }, 4000);
    }
});
