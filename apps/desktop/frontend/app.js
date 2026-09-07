const statusText = document.querySelector("#status-text");
const retryButton = document.querySelector("#retry-button");

const startedAt = Date.now();

function updateStatus() {
  const elapsed = Date.now() - startedAt;
  statusText.textContent =
    elapsed < 6500 ? "正在检测服务..." : "服务尚未连接，App 会继续自动重试";
}

retryButton.addEventListener("click", () => {
  statusText.textContent = "正在重新检测服务...";
  retryButton.disabled = true;
  setTimeout(() => window.location.reload(), 350);
});

updateStatus();
setInterval(updateStatus, 1000);
