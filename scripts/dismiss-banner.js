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
}
