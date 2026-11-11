const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dailyflow-playwright-'));
const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
const localBrowserCache = path.join(projectRoot, 'node_modules', 'playwright-core', '.local-browsers');
const useLocalBrowserCache = fs.existsSync(localBrowserCache) &&
  fs.readdirSync(localBrowserCache).some(name => name.startsWith('chromium-'));
let serverProcess;
let testProcess;
let interrupted = false;
let authServerProcess;

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function startServer(port, directory, token) {
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: directory };
  if (token) env.DAILYFLOW_API_TOKEN = token;
  else delete env.DAILYFLOW_API_TOKEN;
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.output = '';
  child.stdout.on('data', chunk => { child.output += chunk; });
  child.stderr.on('data', chunk => { child.output += chunk; });
  return child;
}

async function waitForHealth(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`DailyFlow server exited before becoming healthy.\n${child.output}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch (error) {
      // The server may still be starting or binding its local port.
    }
    await delay(100);
  }
  throw new Error(`DailyFlow server did not become healthy at ${url}.\n${child.output}`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = exited => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, 2_000)) return;
  child.kill('SIGKILL');
  await waitForExit(child, 2_000);
}

function interrupt() {
  interrupted = true;
  if (testProcess && testProcess.exitCode === null) testProcess.kill('SIGINT');
}

async function run() {
  const port = await reservePort();
  const authPort = await reservePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const authBaseURL = `http://127.0.0.1:${authPort}`;
  const apiToken = randomBytes(32).toString('hex');
  serverProcess = startServer(port, dataDirectory);
  authServerProcess = startServer(authPort, path.join(dataDirectory, 'auth'), apiToken);

  await Promise.all([
    waitForHealth(`${baseURL}/api/health`, serverProcess),
    waitForHealth(`${authBaseURL}/api/health`, authServerProcess)
  ]);

  const cliPath = path.join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  testProcess = spawn(process.execPath, [cliPath, 'test', ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DAILYFLOW_TEST_BASE_URL: baseURL,
      DAILYFLOW_AUTH_TEST_URL: authBaseURL,
      DAILYFLOW_AUTH_TEST_TOKEN: apiToken,
      ...(useLocalBrowserCache ? { PLAYWRIGHT_BROWSERS_PATH: '0' } : {})
    },
    stdio: 'inherit'
  });

  const testExitCode = await new Promise((resolve, reject) => {
    testProcess.once('error', reject);
    testProcess.once('exit', (code, signal) => {
      if (signal && !interrupted) return reject(new Error(`Playwright exited with signal ${signal}.`));
      resolve(code ?? (interrupted ? 130 : 1));
    });
  });
  process.exitCode = testExitCode;
}

process.on('SIGINT', interrupt);

run()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopChild(testProcess);
    await stopChild(serverProcess);
    await stopChild(authServerProcess);
    const resolvedDataDirectory = path.resolve(dataDirectory);
    if (resolvedDataDirectory.startsWith(tempRoot)) {
      fs.rmSync(resolvedDataDirectory, { recursive: true, force: true });
    }
    process.removeListener('SIGINT', interrupt);
  });
