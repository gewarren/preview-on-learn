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

// Gets the latest commit SHA and status of the PR.
export async function getPrInfo(owner, repo, prNumber) {
    try {
        console.log(`Attempting to get latest commit and status for PR #${prNumber} in ${owner}/${repo}`);

        // Get the PR details, which includes the latest commit SHA and status.
        const { data: pullRequest } = await octokit.pulls.get({
            owner,
            repo,
            pull_number: prNumber
        });

        if (pullRequest && pullRequest.head && pullRequest.head.sha) {
            const latestCommitSha = pullRequest.head.sha;

            // Determine PR status: GitHub API returns 'open' or 'closed',
            // but we need to distinguish between 'closed' and 'merged'
            let prStatus;
            if (pullRequest.state === 'open') {
                prStatus = 'open';
            } else if (pullRequest.merged) {
                prStatus = 'merged';
            } else {
                prStatus = 'closed';
            }

            console.log(`Latest commit SHA: ${latestCommitSha}, PR status: ${prStatus}`);
            return {
                commitSha: latestCommitSha,
                prStatus: prStatus
            };
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
    const maxRetries = 3;
    let retryDelay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Attempting to find status check "${checkName}" (attempt ${attempt}/${maxRetries})`);

            const statusChecks = await getStatusChecks(owner, repo, commitSha);

            const exactMatch = statusChecks.find(status =>
                status.context === checkName
            );

            if (exactMatch) {
                console.log(`Found exact matching status check: ${exactMatch.context}`);
                return {
                    name: exactMatch.context,
                    status: exactMatch.state,
                    details_url: exactMatch.target_url
                };
            }

            console.warn(`No status check found with name "${checkName}" on attempt ${attempt}`);
        } catch (error) {
            console.error(`Error fetching specific status check on attempt ${attempt}:`, error);
        }
        finally {
            // If this isn't the last attempt, wait before retrying.
            if (attempt < maxRetries) {
                retryDelay = retryDelay * 2;
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    console.warn(`Failed to find status check "${checkName}" after ${maxRetries} attempts`);
    return null;
}
