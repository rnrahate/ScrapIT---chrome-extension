# Gemma Web Companion Agent Server

## Setup
1. Copy `.env.example` to `.env` and fill in API keys.
2. Run `npm install` and `npm run dev` or use Docker: `docker-compose up --build`.

## API Example
```bash
curl -N -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" -d '{"sessionId":"123","messages":[{"role":"user","content":"Where is the Eiffel Tower?"}],"pageContext":{"url":"https://example.com","title":"","text":"","truncated":false},"client":{"locale":"en","version":"1.0"}}' http://localhost:3000/v1/chat
```

## Cost Control & Abuse Prevention
- Rate Limits: Enforced globally via fastify-rate-limit.
- Tool Bounds: Max 4 iterations and 45s wall-clock time limit.
- Data Retention: None by default. No raw page text in INFO logs.

## Threat Model
- SSRF: Strict URL policy filtering internal IP, link-local, and loopback ranges for outbound HTTP fetches.
- Prompt Injection: Page context text is scanned and wrapped with delimiters to prevent instruction execution.
- Token Theft: Constant-time string comparison used to validate tokens.
- Hallucination: Widgets ONLY accept URLs and map coordinates from cached, verified tool results.
