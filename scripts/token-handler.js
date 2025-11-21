// Token operations that work across different extension contexts.
// Uses message passing for content scripts, direct access for popup/background.

// Message types.
const TOKEN_MESSAGES = {
    CHECK_TOKEN: 'checkToken',
    GET_TOKEN: 'getToken',
    TOKEN_RESPONSE: 'tokenResponse'
};

// Check if we're in a content script context.
function isContentScript() {
    try {
        // Content scripts can access chrome.storage.local but not chrome.storage.session.
        // Also check if we're in a webpage context (content script).
        return typeof chrome !== 'undefined' &&
            typeof chrome.runtime !== 'undefined' &&
            typeof window !== 'undefined' &&
            window.location &&
            window.location.protocol.startsWith('http');
    } catch (e) {
        return false;
    }
}

// Token operations for content scripts (uses message passing).
class ContentScriptTokenHandler {
    async hasGitHubToken() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: TOKEN_MESSAGES.CHECK_TOKEN }, (response) => {
                resolve(response?.hasToken || false);
            });
        });
    }

    async getGitHubToken() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: TOKEN_MESSAGES.GET_TOKEN }, (response) => {
                resolve(response?.token || null);
            });
        });
    }
}

// Token operations for popup/background contexts (direct access).
class DirectTokenHandler {
    constructor(encryption) {
        this.encryption = encryption;
    }

    async hasGitHubToken() {
        try {
            const result = await chrome.storage.sync.get(['githubToken']);
            if (!result.githubToken) {
                return false;
            }

            // Try to decrypt the token to verify it's valid.
            try {
                await this.encryption.decryptToken(result.githubToken);
                return true;
            } catch (decryptError) {
                console.warn('Found invalid encrypted token, clearing it:', decryptError);
                // Clear the invalid token.
                await chrome.storage.sync.remove('githubToken');
                return false;
            }
        } catch (error) {
            console.error("Error checking for GitHub token:", error);
            return false;
        }
    }

    async getGitHubToken() {
        try {
            const result = await chrome.storage.sync.get(['githubToken']);
            if (!result.githubToken) {
                return null;
            }

            try {
                return await this.encryption.decryptToken(result.githubToken);
            } catch (decryptError) {
                console.warn('Found invalid encrypted token, clearing it:', decryptError);
                // Clear the invalid token.
                await chrome.storage.sync.remove('githubToken');
                return null;
            }
        } catch (error) {
            console.error("Error getting GitHub token:", error);
            return null;
        }
    }
}

// Gets the appropriate handler.
export function createTokenHandler(encryption = null) {
    if (isContentScript()) {
        return new ContentScriptTokenHandler();
    } else {
        return new DirectTokenHandler(encryption);
    }
}

// Export the message types for use in background/popup scripts.
export { TOKEN_MESSAGES };
