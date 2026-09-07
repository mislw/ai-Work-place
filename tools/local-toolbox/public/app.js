const state = { selectionId: null, jobId: null, outputPath: null };
const activeStatuses = new Set(["queued", "testing", "extracting"]);
const statusLabels = {
  queued: "已选择",
  testing: "检查压缩包",
  extracting: "解压中",
  needs_password: "需要新密码",
  completed: "已完成",
  failed: "失败",
};
const failureLabels = {
  SPLIT_PART_MISSING: "缺少压缩分卷，请把所有分卷放在同一文件夹。",
  SPLIT_AMBIGUOUS: "发现重复编号的压缩分卷，请检查文件名。",
  ARCHIVE_ENGINE_UNAVAILABLE: "缺少支持该格式的解压引擎。",
  ARCHIVE_TEST_FAILED: "压缩包格式不受支持或文件已损坏。",
  ARCHIVE_EXTRACTION_FAILED: "解压失败，请检查压缩包完整性。",
  ARCHIVE_DISCOVERY_FAILED: "没有找到可解压的压缩包。",
  ARCHIVE_PROCESSING_FAILED: "处理压缩包时发生错误。",
  NESTED_DISCOVERY_FAILED: "已解压，但检查内层压缩包失败。",
  NESTED_DEPTH_EXCEEDED: "内层压缩包层数超过限制。",
};

const selectionLabel = document.querySelector('[data-role="selection"]');
const statusLabel = document.querySelector('[data-role="status"]');
const processedLabel = document.querySelector('[data-role="processed"]');
const countsLabel = document.querySelector('[data-role="counts"]');
const outputLabel = document.querySelector('[data-role="output"]');
const progressBar = document.querySelector('[data-role="progress"]');
const progressValue = document.querySelector('[data-role="progress-value"]');
const errorLabel = document.querySelector('[data-role="error"]');
const passwordInput = document.querySelector('input[type="password"]');
const startButton = document.querySelector('[data-action="start"]');
const revealButton = document.querySelector('[data-action="reveal-output"]');

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.method
      ? { "Content-Type": "application/json", "X-Local-Toolbox": "1" }
      : undefined,
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error || "请求失败");
  return body;
}

function showError(message = "") {
  errorLabel.textContent = message;
  errorLabel.hidden = !message;
}

function renderSnapshot(snapshot) {
  state.jobId = snapshot.jobId;
  state.outputPath = snapshot.primaryOutputPath;
  statusLabel.textContent = statusLabels[snapshot.status] || snapshot.status;
  processedLabel.textContent = String(snapshot.processedArchives || 0);
  countsLabel.textContent = `${snapshot.successCount || 0} / ${snapshot.failureCount || 0}`;
  outputLabel.textContent = snapshot.primaryOutputPath || "-";
  progressBar.value = snapshot.progressPercent;
  progressBar.textContent = `${snapshot.progressPercent}%`;
  progressValue.textContent = `${snapshot.progressPercent}%`;
  revealButton.disabled = snapshot.status !== "completed" || !snapshot.primaryOutputPath;
  startButton.disabled = snapshot.status !== "needs_password";
  startButton.textContent = snapshot.status === "needs_password" ? "提交新密码" : "开始解压";
  const messages = (snapshot.failures || [])
    .map((failure) => failureLabels[failure.code] || "解压失败。")
    .filter((message, index, all) => all.indexOf(message) === index);
  showError(messages.join(" "));
}

async function pick(mode) {
  showError();
  try {
    const selection = await request("/api/selections", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    state.selectionId = selection.selectionId;
    state.jobId = null;
    selectionLabel.textContent = selection.displayName;
    statusLabel.textContent = "已选择";
    startButton.disabled = false;
  } catch (error) {
    showError(error.message);
  }
}

async function startOrResume() {
  showError();
  const password = passwordInput.value;
  passwordInput.value = "";
  try {
    const snapshot = state.jobId
      ? await request(`/api/jobs/${state.jobId}/password`, {
          method: "POST",
          body: JSON.stringify({ password }),
        })
      : await request("/api/jobs", {
          method: "POST",
          body: JSON.stringify({ selectionId: state.selectionId, password }),
        });
    renderSnapshot(snapshot);
    if (activeStatuses.has(snapshot.status)) window.setTimeout(pollJob, 500);
  } catch (error) {
    showError(error.message);
  }
}

async function pollJob() {
  if (!state.jobId) return;
  try {
    const snapshot = await request(`/api/jobs/${state.jobId}`);
    renderSnapshot(snapshot);
    if (activeStatuses.has(snapshot.status)) window.setTimeout(pollJob, 500);
  } catch (error) {
    showError(error.message);
  }
}

document.querySelector('[data-action="pick-file"]').addEventListener("click", () => pick("file"));
document.querySelector('[data-action="pick-folder"]').addEventListener("click", () => pick("folder"));
startButton.addEventListener("click", startOrResume);
revealButton.addEventListener("click", async () => {
  if (!state.jobId) return;
  try {
    await request(`/api/jobs/${state.jobId}/reveal`, { method: "POST", body: "{}" });
  } catch (error) {
    showError(error.message);
  }
});
