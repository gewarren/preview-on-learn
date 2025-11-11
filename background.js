// Background script to handle token operations from content scripts.
import { createTokenHandler, TOKEN_MESSAGES } from './scripts/token-handler.js';
import { tokenEncryption } from './scripts/encryption.js';

// Create token handler with encryption for background context.
const tokenHandler = createTokenHandler(tokenEncryption);

// Handle messages from content scripts.
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
});
