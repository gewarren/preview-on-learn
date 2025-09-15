function addButton(fileDropDown) {
  // Add divider.
  let divider = document.createElement("div");
  divider.className = "dropdown-divider";
  divider.setAttribute("role", "separator");
  fileDropDown.appendChild(divider);

  let previewButton = document.createElement("button");

  // Set attributes and properties.
  previewButton.className = "pl-5 dropdown-item btn-link preview-on-learn";
  previewButton.setAttribute("role", "menuitem");
  previewButton.setAttribute("type", "button");
  previewButton.textContent = "Preview on Learn";

  // Add event listener.
  previewButton.addEventListener("click", function () {
    console.log("Preview on Learn button clicked!");
  });

  fileDropDown.appendChild(previewButton);
}

// Select all dropdown menus and add the button to each one
const dropdownMenus = document.querySelectorAll(".js-file-header-dropdown .dropdown-menu");
dropdownMenus.forEach(menu => {
  // Check if this menu already has our custom button to avoid duplicates
  if (!menu.querySelector('.preview-on-learn')) {
    addButton(menu);
  }
});
