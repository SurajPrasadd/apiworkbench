import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as crypto from 'crypto';

interface MultipartPart {
  name: string;
  value?: string;          // text field
  filename?: string;       // file field (present together with dataBase64)
  contentType?: string;
  dataBase64?: string;
}

interface HttpPayload {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;     // binary body
  multipart?: MultipartPart[];
  timeoutMs?: number;
}

interface HttpResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  size: number;
  time: number;
}

interface WebviewMessage {
  type: string;
  id: string;
  payload?: HttpPayload;
  data?: unknown;
}

let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('apiWorkbench.open', () => openPanel(context)),
    vscode.commands.registerCommand('apiWorkbench.revealDataFile', async () => {
      const file = dataFilePath(context);
      if (!fs.existsSync(file)) {
        void vscode.window.showInformationMessage(`API Workbench has not saved any data yet. Data file: ${file}`);
        return;
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
    })
  );
}

// ---- State file (replaces webview localStorage, which has a small quota) ----

function dataFilePath(context: vscode.ExtensionContext): string {
  let configured = vscode.workspace.getConfiguration('apiWorkbench').get<string>('dataFilePath', '').trim();
  if (configured) {
    configured = configured.replace(/^~(?=$|[\\/])/, os.homedir());
    if (path.isAbsolute(configured)) { return configured; }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) { return path.join(folder, configured); }
  }
  return path.join(context.globalStorageUri.fsPath, 'workbench-data.json');
}

async function readState(file: string): Promise<{ data: unknown; warning?: string }> {
  let text: string;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') { return { data: null }; }
    throw e;
  }
  if (!text.trim()) { return { data: null }; }
  try {
    return { data: JSON.parse(text) };
  } catch {
    // Never silently discard a damaged file: keep a copy, then start fresh.
    const backup = `${file}.corrupt-${Date.now()}`;
    await fs.promises.copyFile(file, backup);
    return { data: null, warning: `Data file was not valid JSON. A copy was kept at ${backup}` };
  }
}

let writeQueue: Promise<void> = Promise.resolve();
function writeState(file: string, data: unknown): Promise<void> {
  const job = writeQueue.then(async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rename(tmp, file);   // atomic replace: a crash never leaves a half-written file
  });
  writeQueue = job.catch(() => undefined);
  return job;
}

function openPanel(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal();
    return;
  }

  const current = vscode.window.createWebviewPanel(
    'apiWorkbench',
    'API Workbench',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel = current;
  current.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);

  // No connect-src: the page never calls fetch(); this extension host does.
  const csp = [
    "default-src 'none'",
    // 'unsafe-eval' lets the Pre-request / Post-response script tabs run (new Function).
    `script-src ${current.webview.cspSource} 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com`,
    `style-src ${current.webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com`,
    'font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com',
    'img-src data: https:'
  ].join('; ');

  const file = path.join(context.extensionPath, 'media', 'api-workbench.html');
  const html = fs.readFileSync(file, 'utf8')
    .replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  current.webview.html = html;

  current.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
    if (!msg) { return; }
    if (msg.type === 'httpRequest' && msg.payload) {
      try {
        const result = await sendHttp(msg.payload);
        void current.webview.postMessage({ type: 'httpResponse', id: msg.id, ok: true, result });
      } catch (e) {
        void current.webview.postMessage({ type: 'httpResponse', id: msg.id, ok: false, error: describe(e) });
      }
    } else if (msg.type === 'revealDataFile') {
      void vscode.commands.executeCommand('apiWorkbench.revealDataFile');
      void current.webview.postMessage({ type: 'rpcResult', id: msg.id, ok: true });
    } else if (msg.type === 'stateLoad' || msg.type === 'stateSave') {
      try {
        const file = dataFilePath(context);
        if (msg.type === 'stateLoad') {
          const r = await readState(file);
          void current.webview.postMessage({ type: 'rpcResult', id: msg.id, ok: true, data: r.data, warning: r.warning, file });
        } else {
          await writeState(file, msg.data);
          void current.webview.postMessage({ type: 'rpcResult', id: msg.id, ok: true, file });
        }
      } catch (e) {
        void current.webview.postMessage({ type: 'rpcResult', id: msg.id, ok: false, error: describe(e) });
      }
    }
  }, null, context.subscriptions);
}

function describe(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  const code = err && err.code ? `${err.code}: ` : '';
  return code + ((err && err.message) || String(e));
}

function buildMultipart(parts: MultipartPart[]): { buffer: Buffer; contentType: string } {
  const boundary = '----ApiWorkbench' + crypto.randomBytes(12).toString('hex');
  const quote = (v: string) => v.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const isFile = part.dataBase64 !== undefined;
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${quote(part.name)}"`;
    if (isFile) { head += `; filename="${quote(part.filename ?? 'file')}"`; }
    head += '\r\n';
    if (isFile) { head += `Content-Type: ${part.contentType || 'application/octet-stream'}\r\n`; }
    head += '\r\n';
    chunks.push(
      Buffer.from(head, 'utf8'),
      isFile ? Buffer.from(part.dataBase64 as string, 'base64') : Buffer.from(part.value ?? '', 'utf8'),
      Buffer.from('\r\n', 'utf8')
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { buffer: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function dropHeader(headers: Record<string, string>, name: string): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name) { delete headers[k]; }
  }
}

function sendHttp(p: HttpPayload): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    let u: URL;
    try { u = new URL(p.url); } catch (e) { reject(e); return; }

    const lib = u.protocol === 'https:' ? https : http;
    const insecure = vscode.workspace.getConfiguration('apiWorkbench').get<boolean>('allowInsecureTls', false);
    const started = Date.now();

    const headers: Record<string, string> = { ...(p.headers ?? {}) };
    const hasBody = p.method !== 'GET' && p.method !== 'HEAD';
    let bodyBuf: Buffer | undefined;
    if (hasBody) {
      if (p.multipart) {
        const m = buildMultipart(p.multipart);
        bodyBuf = m.buffer;
        dropHeader(headers, 'content-type');
        headers['Content-Type'] = m.contentType;
      } else if (p.bodyBase64 != null) {
        bodyBuf = Buffer.from(p.bodyBase64, 'base64');
      } else if (p.body != null) {
        bodyBuf = Buffer.from(p.body, 'utf8');
      }
      if (bodyBuf) {
        dropHeader(headers, 'content-length');
        headers['Content-Length'] = String(bodyBuf.length);
      }
    }

    const req = lib.request(u, {
      method: p.method,
      headers,
      rejectUnauthorized: !insecure,
      timeout: p.timeoutMs ?? 60000
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const resHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) { resHeaders[k] = Array.isArray(v) ? v.join(', ') : v; }
        }
        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          headers: resHeaders,
          bodyText: buf.toString('utf8'),
          size: buf.length,
          time: Date.now() - started
        });
      });
      res.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (bodyBuf) { req.write(bodyBuf); }
    req.end();
  });
}

export function deactivate(): void {}