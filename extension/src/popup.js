/**
 * Agentic Job Ops popup script.
 *
 * Minimal UI for connecting to the active tab, requesting page structure,
 * and applying a fill plan. Authorization to inspect the page is gated on
 * the user clicking Connect — no automatic page reads happen on install.
 */

const connectionStatus = document.getElementById("connection-status");
const connectionDetail = document.getElementById("connection-detail");
const connectButton = document.getElementById("connect-button");
const disconnectButton = document.getElementById("disconnect-button");
const actionsPanel = document.getElementById("actions-panel");
const extractButton = document.getElementById("extract-button");
const fillButton = document.getElementById("fill-button");
const resultPanel = document.getElementById("result-panel");
const resultDetail = document.getElementById("result-detail");
const resultFields = document.getElementById("result-fields");

let lastStructure = null;

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response ?? { ok: false, error: chrome.runtime.lastError?.message });
    });
  });
}

function setStatus(label, detailHtml) {
  connectionStatus.textContent = label;
  if (detailHtml) {
    connectionDetail.innerHTML = detailHtml;
  }
}

function showActions(visible) {
  actionsPanel.hidden = !visible;
  disconnectButton.hidden = !visible;
  connectButton.hidden = visible;
}

function showResult(detailHtml, fields) {
  resultPanel.hidden = false;
  resultDetail.innerHTML = detailHtml;
  if (fields && fields.length > 0) {
    resultFields.hidden = false;
    resultFields.innerHTML = fields
      .map(
        (field) => `
          <div class="field-list-item">
            <div class="label">${escapeHtml(field.label)}</div>
            <div class="meta">
              ${escapeHtml(field.fieldType)} · required: ${field.required ? "yes" : "no"} · sensitive: ${field.sensitive ? "yes" : "no"}
            </div>
          </div>
        `
      )
      .join("");
  } else {
    resultFields.hidden = true;
    resultFields.innerHTML = "";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function refreshConnection() {
  const response = await send({ type: "agentic-job-ops/get-active-session" });
  if (response.ok && response.session) {
    setStatus(
      "Connected",
      `<p><strong>${escapeHtml(response.session.pageTitle || "Untitled page")}</strong></p>
       <p>${escapeHtml(response.session.pageUrl)}</p>`
    );
    showActions(true);
  } else {
    setStatus(
      "Not connected",
      `<p>Open a job application page, then click connect.</p>`
    );
    showActions(false);
  }
}

connectButton.addEventListener("click", async () => {
  setStatus("Connecting...", "");
  const response = await send({ type: "agentic-job-ops/connect-active-tab" });
  if (response.ok) {
    await refreshConnection();
  } else {
    setStatus("Could not connect", `<p>${escapeHtml(response.error || "Unknown error")}</p>`);
  }
});

disconnectButton.addEventListener("click", async () => {
  await send({ type: "agentic-job-ops/disconnect" });
  await refreshConnection();
  showResult("<p>Disconnected.</p>", []);
});

extractButton.addEventListener("click", async () => {
  showResult("<p>Reading page structure…</p>", []);
  const response = await send({ type: "agentic-job-ops/extract" });
  if (response.ok) {
    lastStructure = response.structure;
    const fieldCount = response.structure.fields.length;
    showResult(
      `<p><strong>${fieldCount}</strong> fields detected.</p>
       <p>Captcha: ${response.structure.hasCaptcha ? "yes (will pause)" : "no"} ·
          Login: ${response.structure.hasLoginChallenge ? "yes (will pause)" : "no"} ·
          Submit button: ${response.structure.hasSubmitButton ? "yes" : "no"}</p>
       <p>Send this structure to the Agentic Job Ops app to receive a safe fill plan.</p>`,
      response.structure.fields
    );
  } else {
    showResult(`<p>${escapeHtml(response.error || "Could not read structure")}</p>`, []);
  }
});

fillButton.addEventListener("click", async () => {
  if (!lastStructure) {
    showResult(
      "<p>Read the page structure first; the fill plan needs detected fields.</p>",
      []
    );
    return;
  }
  // Demo fill plan: only fills non-sensitive, non-file, non-select fields with
  // a safe placeholder. Production replaces this with the app-approved plan.
  const fields = lastStructure.fields
    .filter(
      (field) =>
        !field.sensitive &&
        field.fieldType !== "file" &&
        field.fieldType !== "select" &&
        field.fieldType !== "checkbox"
    )
    .map((field) => ({
      fieldId: field.fieldId,
      inputId: field.inputId,
      inputName: field.inputName,
      valuePreview: `Demo value for ${field.label}`
    }));
  const response = await send({
    type: "agentic-job-ops/apply-fill-plan",
    fields
  });
  if (response.ok) {
    showResult(
      `<p>Filled <strong>${response.filledFieldIds?.length ?? 0}</strong> safe fields. The extension never clicks submit.</p>`,
      []
    );
  } else {
    showResult(`<p>${escapeHtml(response.error || "Could not fill fields")}</p>`, []);
  }
});

refreshConnection();
