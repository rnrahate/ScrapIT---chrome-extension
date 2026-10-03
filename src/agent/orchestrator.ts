import { ModelClient } from '../providers/model-client.js';
import { tools, toolSchemas } from '../tools/registry.js';
import { systemPrompt } from './system-prompt.js';
import { envelopeSchema } from './output-schema.js';
import { guardPageContext } from '../security/injection-guard.js';
import crypto from 'crypto';

const MAX_TOOL_ITERATIONS = 4;
const WALL_CLOCK_BUDGET = 45000;

export async function orchestrate(requestData: any, sse: any) {
  const startTime = Date.now();
  const client = new ModelClient();
  
  const messages = [
    { role: 'system', content: systemPrompt + '\n\n' + guardPageContext(requestData.pageContext.text) },
    ...requestData.messages
  ];

  let iterations = 0;
  const activeToolResults = new Map<string, any>();
  let inputTokens = 0, outputTokens = 0, toolCallsCount = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    if (Date.now() - startTime > WALL_CLOCK_BUDGET) {
      throw new Error("Wall-clock budget exceeded");
    }

    const responseMsg = await client.call(messages, toolSchemas);
    
    inputTokens += 100; outputTokens += 50;

    messages.push(responseMsg);

    if (responseMsg.tool_calls && responseMsg.tool_calls.length > 0) {
      toolCallsCount += responseMsg.tool_calls.length;
      
      const promises = responseMsg.tool_calls.map(async (call: any) => {
        try {
          const fn = (tools as any)[call.function.name];
          if (!fn) throw new Error("Unknown tool");
          const args = JSON.parse(call.function.arguments);
          const result = await Promise.race([
             fn(args),
             new Promise((_, reject) => setTimeout(() => reject(new Error("Tool timeout")), 8000))
          ]);
          
          const resultId = `r_${crypto.randomBytes(4).toString('hex')}`;
          activeToolResults.set(resultId, result);

          return {
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify({ result_id: resultId, data: result })
          };
        } catch (err: any) {
          return {
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify({ error: err.message })
          };
        }
      });
      
      const results = await Promise.all(promises);
      messages.push(...results);
      iterations++;
    } else {
      let parsed = envelopeSchema.safeParse(JSON.parse(responseMsg.content));
      if (!parsed.success) {
         messages.push({ role: 'user', content: 'Invalid JSON. Please output strictly according to schema.'});
         const repairMsg = await client.call(messages, toolSchemas);
         parsed = envelopeSchema.safeParse(JSON.parse(repairMsg.content));
         if (!parsed.success) {
            parsed = { success: true, data: { type: 'text', content: 'Fallback: I encountered an error producing the response.' } } as any;
         }
      }

      if (parsed.success) {
        if (parsed.data.type === 'text') {
           sse.send('delta', { text: parsed.data.content });
        } else if (parsed.data.type === 'widget_render') {
           const storedResult = activeToolResults.get(parsed.data.result_id);
           if (!storedResult) {
               sse.send('delta', { text: parsed.data.fallback_text });
           } else {
               sse.send('widget', {
                 type: 'widget_render',
                 widget: parsed.data.widget,
                 payload: parsed.data.widget === 'map' ? storedResult : storedResult.results[0],
                 fallback_text: parsed.data.fallback_text
               });
           }
        }
      }

      sse.send('done', {
        usage: { input_tokens: inputTokens, output_tokens: outputTokens, tool_calls: toolCallsCount }
      });
      break;
    }
  }
}
