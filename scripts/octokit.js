import { Octokit } from "@octokit/rest";

// Create a default instance that will be replaced when fully initialized.
let octokit = new Octokit();

// Initialize Octokit with stored access token
export async function initializeOctokit() {
    try {
        // Get existing access token from storage
        const result = await chrome.storage.sync.get(['githubAccessToken']);
        let accessToken = result.githubAccessToken;

        if (!accessToken) {
            console.log("No access token found");
            octokit = null;
            return null;
        }

        console.log("Using authenticated GitHub API with Personal Access Token");
        octokit = new Octokit({ auth: accessToken });

        // Verify the token is still valid
        try {
            await octokit.users.getAuthenticated();
            console.log("GitHub authentication successful");
            return octokit;
        } catch (error) {
            if (error.status === 401) {
                console.log("Access token expired or invalid");
                // Clear the invalid token
                await chrome.storage.sync.remove(['githubAccessToken']);
                octokit = null;
                return null;
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error("Error initializing Octokit:", error);
        octokit = null;
        return null;
    }
}

// Check if user is authenticated
export async function isAuthenticated() {
    try {
        const result = await chrome.storage.sync.get(['githubAccessToken']);
        return !!result.githubAccessToken;
    } catch (error) {
        console.error("Error checking authentication:", error);
        return false;
    }
}

// Clear stored authentication
export async function clearAuth() {
    try {
        await chrome.storage.sync.remove(['githubAccessToken']);
        octokit = new Octokit(); // Reset to unauthenticated instance
        console.log("GitHub authentication cleared");
    } catch (error) {
        console.error("Error clearing authentication:", error);
    }
}

// Export the octokit instance.
export { octokit };
