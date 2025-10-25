// Content script for review.learn.microsoft.com to dismiss the banner
console.log("Preview on Learn: Banner dismissal script loaded");

function dismissBanner() {
    // Look for the dismiss button
    const dismissButton = document.querySelector('button[data-dismiss][data-bi-name="close"].delete');

    if (dismissButton) {
        console.log("Preview on Learn: Found banner dismiss button, clicking it");
        dismissButton.click();
        return true;
    }

    return false;
}

// Try to dismiss immediately when script loads
if (dismissBanner()) {
    console.log("Preview on Learn: Banner dismissed successfully");
} else {
    // If banner not found, wait a bit for dynamic content to load
    console.log("Preview on Learn: Banner not found yet, will retry");

    // Use MutationObserver to watch for banner appearing
    const observer = new MutationObserver((mutations) => {
        if (dismissBanner()) {
            console.log("Preview on Learn: Banner dismissed successfully after waiting");
            observer.disconnect();
        }
    });

    // Observe the document for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Also try a few times with timeouts as a fallback
    let attempts = 0;
    const maxAttempts = 10;
    const retryInterval = setInterval(() => {
        attempts++;

        if (dismissBanner()) {
            console.log("Preview on Learn: Banner dismissed successfully after retry");
            clearInterval(retryInterval);
            observer.disconnect();
        } else if (attempts >= maxAttempts) {
            console.log("Preview on Learn: Banner not found after maximum attempts");
            clearInterval(retryInterval);
            observer.disconnect();
        }
    }, 500); // Try every 500ms
}
