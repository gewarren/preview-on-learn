import { Octokit } from "@octokit/rest";

export let octokit;

// Initializes Octokit, with auth if available.
export async function initializeOctokit() {
    try {
        // Get token from Chrome storage.
        const result = await chrome.storage.sync.get(['githubToken']);
        const token = result.githubToken;

        if (token) {
            console.log("Using authenticated GitHub API with token.");

            // Create Octokit instance with the token.
            octokit = new Octokit({ auth: token });

            // Test the token to make sure it works.
            try {
                const { data } = await octokit.users.getAuthenticated();
                console.log("GitHub API authentication successful. Authenticated as:", data.login);

                // Log the scopes that this token has.
                const response = await fetch('https://api.github.com/user', {
                    headers: {
                        'Authorization': `token ${token}`
                    }
                });

                // Log the headers to see the scopes.
                const scopes = response.headers.get('x-oauth-scopes') || 'none';
                console.log("Token scopes:", scopes);

                if (!scopes.includes('repo')) {
                    console.warn("WARNING: Your token does not have the 'repo' scope, which is required for private repos.");
                }

                // Add warning about SAML SSO organizations.
                const headersSSOWarning = response.headers.get('x-github-sso');
                if (headersSSOWarning) {
                    console.warn("WARNING: The organization you're trying to access requires SAML SSO authorization.");
                    console.warn("Visit https://github.com/settings/tokens, click 'Configure SSO' next to your token, and authorize the organization.");
                }
            } catch (authError) {
                console.error("Authentication test failed:", authError);
                // Fall back to unauthenticated if the token is invalid.
                octokit = new Octokit();
            }
        } else {
            console.log("No GitHub token found, using unauthenticated API.");
            octokit = new Octokit();
        }
    } catch (error) {
        console.error("Error initializing Octokit:", error);
        // Fall back to unauthenticated.
        octokit = new Octokit();
    }
}
