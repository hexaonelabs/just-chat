import { app, BrowserWindow } from 'electron';
import { format, fileURLToPath } from 'url';
import { join, dirname } from 'path';
import relayer from './src/relay.js';

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = dirname(__filename); // get the name of the directory

let mainWindow

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      preload: join(__dirname, 'preload.js')
    }
  });

  // // Dynamically import preload.js
  // const preloadPath = join(__dirname, 'preload.js');
  // const preloadModule = await import(preloadPath);
  // mainWindow.webContents.session.setPreloads([preloadModule.default]);

  await mainWindow.loadURL(
    format({
      pathname: join(__dirname, `/dist/just-chat/browser/index.html`),
      protocol: "file:",
      slashes: true
    })
  );
  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('messageToUI', JSON.stringify({ data: 'hello' }));
  });

  mainWindow.on('closed', function () {
    mainWindow = null
  });

  return mainWindow;
}

app.disableHardwareAcceleration();

app.on('ready', async ()=> {
  const result = await relayer();
  const mainWindow = await createWindow();
  mainWindow.webContents.send('relayer-addresses', JSON.stringify({result}));
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
  if (mainWindow === null) createWindow()
})