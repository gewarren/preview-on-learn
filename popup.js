import { tokenEncryption } from './scripts/encryption.js';
import { createTokenHandler } from './scripts/token-handler.js';

document.addEventListener('DOMContentLoaded', async function () {
    const tokenStatusElement = document.getElementById('token-status');
    const tokenFormElement = document.getElementById('token-form');
    const tokenStepsElement = document.getElementById('token-steps');
    const tokenInput = document.getElementById('github-token');
    const saveTokenButton = document.getElementById('save-token');
    const clearTokenButton = document.getElementById('clear-token');
    const statusElement = document.getElementById('status');

    // Create token handler for popup context.
    const tokenHandler = createTokenHandler(tokenEncryption);

    // Check if a token is already saved.
    try {
        const hasToken = await tokenHandler.hasGitHubToken();
        if (hasToken) {
            // Token exists and is valid - show the token status and hide the form and steps.
            tokenStatusElement.style.display = 'flex';
            tokenFormElement.style.display = 'none';
            tokenStepsElement.style.display = 'none';
            // Don't show the token value for security.
            tokenInput.value = '';
        } else {
            // No token - show the form and steps, hide the token status.
            tokenStatusElement.style.display = 'none';
            tokenFormElement.style.display = 'block';
            tokenStepsElement.style.display = 'block';
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
            // Encrypt the token before storing
            const encryptedToken = await tokenEncryption.encryptToken(token);
            await chrome.storage.session.set({ githubToken: encryptedToken });

            showStatus("Token saved successfully!", "success");

            // Show the token status and hide the form and steps.
            tokenStatusElement.style.display = 'flex';
            tokenFormElement.style.display = 'none';
            tokenStepsElement.style.display = 'none';
            tokenInput.value = '';

            // Note: The content script will automatically detect the token change via storage listener
        } catch (error) {
            showStatus("Error saving token: " + error.message, "error");
        }
    });

    // Clear token when button is clicked.
    clearTokenButton.addEventListener('click', async function () {
        try {
            await chrome.storage.session.remove('githubToken');

            // Hide the token status and show the form and steps.
            tokenStatusElement.style.display = 'none';
            tokenFormElement.style.display = 'block';
            tokenStepsElement.style.display = 'block';
            tokenInput.value = '';

            showStatus("Token removed successfully!", "success");

            // Note: The content script will automatically detect the token removal via storage listener
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
