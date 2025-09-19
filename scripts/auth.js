// Check if user has entered a GitHub token.
export async function hasGitHubToken() {
    try {
        const result = await chrome.storage.sync.get(['githubToken']);
        return !!result.githubToken;
    } catch (error) {
        console.error("Error checking for GitHub token:", error);
        return false;
    }
}
