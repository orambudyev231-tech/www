// 简单 SSE 事件总线：后台改动后广播，前端实时刷新（配合 20 秒轮询兜底）
const clients = new Set();

export function addClient(res) {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

export function broadcast(type = "update") {
  const payload = `event: ${type}\ndata: ${Date.now()}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}
