import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const host = '127.0.0.1';
const port = 11451;
// 仅提供页面资源，避免将仓库配置和其他本地文件暴露给浏览器。
const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/dashboard.html', ['dashboard.html', 'text/html']],
  ['/login.css', ['login.css', 'text/css']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/login.js', ['login.js', 'text/javascript']],
  ['/token-input.js', ['token-input.js', 'text/javascript']],
  ['/signet.js', ['signet.js', 'text/javascript']],
  ['/fireflies.js', ['fireflies.js', 'text/javascript']],
  ['/assets/images/elysia-signet.png', ['assets/images/elysia-signet.png', 'image/png']],
  ['/assets/images/elysia-signet-solid.png', ['assets/images/elysia-signet-solid.png', 'image/png']],
]);

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const pathname = (request.url ?? '/').split('?')[0];
  const resource = routes.get(pathname);
  if (!resource) {
    response.writeHead(404);
    response.end();
    return;
  }

  const [file, contentType] = resource;
  try {
    const content = await readFile(new URL(file, import.meta.url));
    response.writeHead(200, {
      'Content-Type': contentType.startsWith('text/') ? `${contentType}; charset=utf-8` : contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(`读取页面资源失败：${file}`, error);
    response.writeHead(500);
    response.end();
  }
});

server.on('error', (error) => {
  console.error(`服务启动或运行失败：${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`登录演示服务已启动：http://${host}:${port}`);
  console.log('按 Ctrl+C 停止服务。');
});
