import { spawn } from "node:child_process";

const filePickerScript = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
  "$dialog.Multiselect = $false",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
  "  $bytes = [System.Text.Encoding]::Unicode.GetBytes($dialog.FileName)",
  "  [Console]::Out.Write([Convert]::ToBase64String($bytes))",
  "}",
].join("; ");

const folderPickerScript = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
  "  $bytes = [System.Text.Encoding]::Unicode.GetBytes($dialog.SelectedPath)",
  "  [Console]::Out.Write([Convert]::ToBase64String($bytes))",
  "}",
].join("; ");

export async function pickWindowsPath(
  mode: "file" | "folder",
): Promise<string | null> {
  const script = mode === "file" ? filePickerScript : folderPickerScript;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-Sta", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let output = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error("Native picker failed."));
        return;
      }
      const encodedPath = output.trim();
      resolve(
        encodedPath
          ? Buffer.from(encodedPath, "base64").toString("utf16le")
          : null,
      );
    });
  });
}
