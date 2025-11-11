import { createTokenHandler } from './token-handler.js';

// Create the appropriate token handler for this context.
const tokenHandler = createTokenHandler();

// Check if user has entered a GitHub token.
export async function hasGitHubToken() {
    return await tokenHandler.hasGitHubToken();
}

// Get the decrypted GitHub token.
export async function getGitHubToken() {
    return await tokenHandler.getGitHubToken();
}
