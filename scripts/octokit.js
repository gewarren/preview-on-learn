import { Octokit } from "@octokit/rest";
import { getGitHubToken } from './auth.js';

// Create a default instance that will be replaced when fully initialized.
let octokit = new Octokit();

// Initialize Octokit, with auth if available.
export async function initializeOctokit() {
    try {
        // Get decrypted token.
        const token = await getGitHubToken();

        if (token) {
            console.log("Using authenticated GitHub API");
            octokit = new Octokit({ auth: token });
        } else {
            console.log("No GitHub token found");
            octokit = null;
        }

        return octokit;
    } catch (error) {
        console.error("Error initializing Octokit:", error);
        octokit = null;
        return octokit;
    }
}

// Export the octokit instance.
export { octokit };
