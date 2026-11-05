// Capture-only native shell. Never reads a player's profile or save.
const { app, protocol, net } = require('electron');
if (!process.env.TL_CAPTURE_PROFILE || !process.env.TL_CAPTURE_VITE) {
  throw new Error('Capture profile and local Vite origin are required');
}
const base = new URL(process.env.TL_CAPTURE_VITE);
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  throw new Error('Capture shell accepts only a local renderer server');
}
app.setPath('userData', process.env.TL_CAPTURE_PROFILE);
protocol.registerSchemesAsPrivileged([{
  scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);
app.whenReady().then(() => protocol.handle('app', request => {
  const url = new URL(request.url);
  if (url.hostname !== 'tetrilaunch') return new Response('Unknown capture host', { status: 403 });
  return net.fetch(new URL(url.pathname + url.search, base).href);
}));
app.on('window-all-closed', () => {});
