import { ServerResponse } from 'http';

export function createSSEStream(res: ServerResponse) {
  let heartbeat: NodeJS.Timeout;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  return {
    send,
    close: () => {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.end();
      }
    }
  };
}
