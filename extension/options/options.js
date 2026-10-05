const form = document.querySelector("#settings-form");
const backendUrlInput = document.querySelector("#backend-url");
const projectIdInput = document.querySelector("#project-id");
const ingestionKeyInput = document.querySelector("#ingestion-key");
const clearButton = document.querySelector("#clear-button");
const status = document.querySelector("#status");

const showStatus = (message, isError = false) => {
  status.textContent = message;
  status.dataset.error = String(isError);
};

async function loadSettings() {
  const config = await UXLensConfig.readConfig();
  backendUrlInput.value = config.backendUrl;
  projectIdInput.value = config.projectId;
  ingestionKeyInput.value = config.ingestionKey;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("Validating project...");
  try {
    const backendUrl = UXLensConfig.normalizeBackendUrl(backendUrlInput.value);
    const projectId = projectIdInput.value.trim();
    const ingestionKey = ingestionKeyInput.value.trim();
    if (!projectId) throw new Error("Project ID is required.");
    if (!ingestionKey) throw new Error("Project ingestion key is required.");
    const response = await fetch(`${backendUrl}/api/projects/${encodeURIComponent(projectId)}/problems`, {
      headers: { Authorization: `Bearer ${ingestionKey}` }
    });
    if (!response.ok) throw new Error("The project could not be found.");
    await UXLensConfig.saveConfig({ backendUrl, projectId, ingestionKey });
    showStatus("Configuration saved. Collection is enabled.");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Configuration could not be saved.", true);
  }
});

clearButton.addEventListener("click", async () => {
  await UXLensConfig.clearConfig();
  backendUrlInput.value = UXLensConfig.defaultBackendUrl;
  projectIdInput.value = "";
  ingestionKeyInput.value = "";
  showStatus("Configuration cleared. Collection is disabled.");
});

void loadSettings().catch(() => showStatus("Could not load configuration.", true));