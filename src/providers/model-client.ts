import { request } from 'undici';
import { config } from '../config.js';
import { logger } from '../observability/logger.js';

export async function checkProviders(): Promise<boolean> {
  try {
    const { statusCode } = await request(`${config.MODEL_BASE_URL}/models`, {
      headers: { 'Authorization': `Bearer ${config.MODEL_API_KEY}` }
    });
    if (statusCode === 200) return true;
  } catch {}

  if (config.FALLBACK_MODEL_BASE_URL) {
    try {
      const { statusCode } = await request(`${config.FALLBACK_MODEL_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${config.FALLBACK_MODEL_API_KEY}` }
      });
      if (statusCode === 200) return true;
    } catch {}
  }
  return false;
}

export class ModelClient {
  async call(messages: any[], tools?: any[]): Promise<any> {
    try {
      return await this.executeCall(config.MODEL_BASE_URL, config.MODEL_NAME, config.MODEL_API_KEY, messages, tools);
    } catch (error) {
      if (config.FALLBACK_MODEL_BASE_URL && config.FALLBACK_MODEL_NAME && config.FALLBACK_MODEL_API_KEY) {
        logger.warn('Primary model failed, automatically switching to fallback offline model...');
        return await this.executeCall(config.FALLBACK_MODEL_BASE_URL, config.FALLBACK_MODEL_NAME, config.FALLBACK_MODEL_API_KEY, messages, tools);
      }
      throw error;
    }
  }

  private async executeCall(baseUrl: string, modelName: string, apiKey: string, messages: any[], tools?: any[]): Promise<any> {
    const { statusCode, body } = await request(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        tools,
        temperature: 0.1
      })
    });
    
    if (statusCode !== 200) {
      throw new Error(`Model request failed: ${statusCode}`);
    }
    
    const data = await body.json() as any;
    return data.choices[0].message;
  }
}
