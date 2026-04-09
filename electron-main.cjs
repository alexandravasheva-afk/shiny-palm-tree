const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let serverProcess;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "safeMS Desktop",
    icon: path.join(__dirname, 'public/icon.png'), // Если добавишь иконку
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0a0a0a',
  });

  // Скрываем стандартное меню
  win.setMenuBarVisibility(false);

  // Всегда загружаем через локальный сервер, чтобы работали сокеты и API
  const startUrl = 'http://localhost:3000';

  // Функция для проверки готовности сервера
  const checkServer = () => {
    fetch(startUrl)
      .then(() => {
        win.loadURL(startUrl);
      })
      .catch(() => {
        // Если сервер еще не готов, пробуем снова через 200мс
        setTimeout(checkServer, 200);
      });
  };

  checkServer();

  win.on('closed', () => {
    if (serverProcess) serverProcess.kill();
    app.quit();
  });
}

app.whenReady().then(() => {
  // Запускаем скомпилированный бэкенд-сервер
  const serverPath = path.join(__dirname, 'dist/server.cjs');
  
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '3000' }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
