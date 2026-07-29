import { execFile, execFileSync } from "node:child_process";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const IS_WINDOWS = process.platform === "win32";

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Run an arbitrary command with arguments. No shell interpolation.
 * Caller passes a fixed argv array; never accept user-controlled strings.
 */
export function runExec(cmd: string, args: string[], timeoutMs = 30 * 1000): ExecResult {
  const started = Date.now();
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return { ok: true, stdout, stderr: "", exitCode: 0, durationMs: Date.now() - started };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      ok: false,
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : "",
      exitCode: e.status ?? 1,
      durationMs: Date.now() - started,
    };
  }
}

/** Async variant for streaming-friendly calls. */
export function runExecAsync(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(cmd, args, { cwd: PROJECT_ROOT, encoding: "utf-8", windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        resolve({
          ok: false,
          stdout: e.stdout ?? stdout ?? "",
          stderr: e.stderr ?? stderr ?? "",
          exitCode: e.code ?? 1,
          durationMs: Date.now() - started,
        });
      } else {
        resolve({ ok: true, stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0, durationMs: Date.now() - started });
      }
    });
  });
}

/** Resolve the python executable. Windows prefers `python`, Unix `python3`. */
function pythonCmd(): string {
  return IS_WINDOWS ? "python" : "python3";
}

/** Resolve the docker executable. */
function dockerCmd(): string {
  return IS_WINDOWS ? "docker.exe" : "docker";
}
