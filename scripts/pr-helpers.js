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
        console.log(`Attempting to get commits for PR #${prNumber} in ${owner}/${repo}`);

        // Get list of commits in the PR.
        const { data: commits } = await octokit.pulls.listCommits({
            owner,
            repo,
            pull_number: prNumber
        });

        if (commits && commits.length > 0) {
            // The last commit in the array is the latest one.
            const latestCommit = commits[commits.length - 1];
            console.log(`Latest commit SHA: ${latestCommit.sha}`);
            return latestCommit.sha;
        } else {
            console.warn('No commits found in this PR');
            return null;
        }
    } catch (error) {
        console.error(`Error fetching PR commits:`, error);
        if (error.status === 403) {
            if (error.message && error.message.includes('SAML')) {
                console.log("403 Forbidden error - SAML SSO authorization required:", error.message);
                console.log("You need to authorize your Personal Access Token for this organization. Go to https://github.com/settings/tokens, find your token, click 'Configure SSO', and authorize it for the organization.");
            } else {
                console.log("403 Forbidden error - your token doesn't have access to this repository or the PR doesn't exist");
            }
            // Log more details about the error for debugging.
            console.log("Error details:", {
                message: error.message,
                documentation_url: error.documentation_url,
                headers: error.headers,
                request: error.request
            });
        } else if (error.status === 404) {
            console.log("404 Not Found error - the PR or repository doesn't exist or is private");

            // Check if this might be due to not having a token for a private repo.
            chrome.storage.sync.get(['githubToken'], function (result) {
                if (!result.githubToken) {
                    console.log("No GitHub token found - this could be why you can't access the repo.");
                    showNoTokenNotification();
                }
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
    try {
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

        console.warn(`No status check found with name containing "${checkName}"`);
        return null;
    } catch (error) {
        console.error('Error fetching specific status check:', error);
        return null;
    }
}
