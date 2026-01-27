import { getPrInfoFromDom, getOpsCheckFromDom } from './dom-scraper.js';

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

// Gets the latest commit SHA and status of the PR from DOM scraping.
export async function getPrInfo(owner, repo, prNumber) {
    console.log('getPrInfo: Scraping DOM for PR info...');
    try {
        const domInfo = await getPrInfoFromDom();
        if (domInfo && domInfo.commitSha) {
            console.log(`getPrInfo: Success - SHA: ${domInfo.commitSha}, Status: ${domInfo.prStatus}`);
            return domInfo;
        }
        console.log('getPrInfo: DOM scraping returned incomplete data:', domInfo);
    } catch (domError) {
        console.log('getPrInfo: DOM scraping error:', domError);
    }
    return null;
}

// Gets a specific status check by name from DOM scraping.
export async function getSpecificStatusCheck(owner, repo, commitSha, checkName) {
    if (checkName === 'OpenPublishing.Build') {
        console.log('getSpecificStatusCheck: Scraping DOM for OPS check...');
        try {
            const domCheck = getOpsCheckFromDom();
            if (domCheck && domCheck.details_url) {
                console.log(`getSpecificStatusCheck: Success - Status: ${domCheck.status}, URL: ${domCheck.details_url}`);
                return {
                    name: checkName,
                    status: domCheck.status,
                    details_url: domCheck.details_url
                };
            }
            console.log('getSpecificStatusCheck: DOM scraping returned incomplete data:', domCheck);
        } catch (domError) {
            console.log('getSpecificStatusCheck: DOM scraping error:', domError);
        }
    }
    return null;
}
