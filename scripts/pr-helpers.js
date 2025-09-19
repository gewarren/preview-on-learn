import { octokit } from './octokit.js';

export function extractRepoInfo() {
    const pathParts = window.location.pathname.split('/');
    if (pathParts.length >= 4) {
        return {
            owner: pathParts[1],
            repo: pathParts[2],
            prNumber: pathParts[4]
        };
    }
    return null;
}

// Gets the latest commit SHA of the PR.
export async function getLatestPrCommit(owner, repo, prNumber) {
    try {
        console.log(`Attempting to get latest commit for PR #${prNumber} in ${owner}/${repo}`);

        // Get the PR details, which includes the latest commit SHA.
        const { data: pullRequest } = await octokit.pulls.get({
            owner,
            repo,
            pull_number: prNumber
        });

        if (pullRequest && pullRequest.head && pullRequest.head.sha) {
            const latestCommitSha = pullRequest.head.sha;
            console.log(`Latest commit SHA: ${latestCommitSha}`);
            return latestCommitSha;
        } else {
            console.warn('Could not find commit SHA in PR data');
            return null;
        }
    } catch (error) {
        console.error(`Error fetching PR data. Error status: ${error.status}`);
        if (error.status === 401) {
            if (error.message && error.message.includes('Bad credentials')) {
                console.error("The PAT you entered is valid. Enter a valid PAT.");

                // Clear the invalid token from storage.
                try {
                    await chrome.storage.sync.remove(['githubToken']);
                    console.log("Invalid GitHub token has been cleared from storage");
                } catch (storageError) {
                    console.error("Error clearing invalid token from storage:", storageError);
                }
            }
        }
        else if (error.status === 403) {
            if (error.message && error.message.includes('SAML')) {
                console.log("403 Forbidden error - SAML SSO authorization required:", error.message);
                console.log("You need to authorize your Personal Access Token for this organization. Go to https://github.com/settings/tokens, find your token, click 'Configure SSO', and authorize it for the organization.");
            }
            // Log more details about the error for debugging.
            console.log("Error details:", {
                message: error.message,
                documentation_url: error.documentation_url,
                headers: error.headers,
                request: error.request
            });
        }

        return null;
    }
}

// Gets status checks for a specific commit.
async function getStatusChecks(owner, repo, commitSha) {
    try {
        const { data: statusChecks } = await octokit.repos.getCombinedStatusForRef({
            owner,
            repo,
            ref: commitSha
        });

        return statusChecks.statuses;
    } catch (error) {
        console.error('Error fetching status checks:', error);
        return [];
    }
}

// Gets a specific status check by name.
export async function getSpecificStatusCheck(owner, repo, commitSha, checkName) {
    const maxRetries = 5;
    const retryDelay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Attempting to find status check "${checkName}" (attempt ${attempt}/${maxRetries})`);

            const statusChecks = await getStatusChecks(owner, repo, commitSha);

            const matchingStatusCheck = statusChecks.find(status =>
                status.context.toLowerCase().includes(checkName.toLowerCase())
            );

            if (matchingStatusCheck) {
                console.log(`Found matching status check: ${matchingStatusCheck.context}`);
                return {
                    name: matchingStatusCheck.context,
                    status: matchingStatusCheck.state,
                    details_url: matchingStatusCheck.target_url
                };
            }

            console.warn(`No status check found with name containing "${checkName}" on attempt ${attempt}`);

            // If this isn't the last attempt, wait before retrying
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay = retryDelay * 2));
            }
        } catch (error) {
            console.error(`Error fetching specific status check on attempt ${attempt}:`, error);

            // If this isn't the last attempt, wait before retrying
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay = retryDelay * 2));
            }
        }
    }

    console.warn(`Failed to find status check "${checkName}" after ${maxRetries} attempts`);
    return null;
}
