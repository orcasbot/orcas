/**
 * LLM client — handles conversation with OpenGateway (OpenAI-compatible API).
 * Supports tool use via function calling format.
 */

const { getSystemPrompt } = require('./system-prompt');
const { ALL_TOOLS } = require('./tools');
const { executeTool } = require('./tool-executor');
const logger = require('../../utils/logger');

// Convert Anthropic-style tools to OpenAI function calling format
function convertTools() {
  return ALL_TOOLS.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

class LLMClient {
  constructor(config) {
    this.baseUrl = config.llm.baseUrl;
    this.apiKey = config.llm.apiKey;
    this.model = config.llm.model;
    this.maxTokens = config.llm.maxTokens;
    this.tools = convertTools();
  }

  async _chat(messages, systemPrompt) {
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      tools: this.tools,
      tool_choice: 'auto',
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LLM API error ${resp.status}: ${text}`);
    }

    return resp.json();
  }

  /**
   * Process a user message and return the LLM's response.
   * Handles tool use loops automatically.
   */
  async processMessage(user, conversationHistory, userId) {
    const systemPrompt = getSystemPrompt(user);
    const messages = [...conversationHistory];

    try {
      let response = await this._chat(messages, systemPrompt);
      let choice = response.choices[0];
      let message = choice.message;

      // Handle tool use loops
      while (choice.finish_reason === 'tool_calls' || (message.tool_calls && message.tool_calls.length > 0)) {
        const toolResults = [];

        for (const tc of message.tool_calls) {
          const fn = tc.function;
          let args;
          try {
            args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments;
          } catch {
            args = {};
          }

          logger.info('Tool call', { tool: fn.name, args });

          try {
            const result = await executeTool(fn.name, args, userId);
            toolResults.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            logger.error('Tool execution failed', { tool: fn.name, error: err.message });
            toolResults.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ error: err.message }),
            });
          }
        }

        // Add assistant message + tool results to conversation
        messages.push(message);
        messages.push(...toolResults);

        // Get next response
        response = await this._chat(messages, systemPrompt);
        choice = response.choices[0];
        message = choice.message;
      }

      return {
        text: message.content || '',
        usage: response.usage || {},
      };
    } catch (err) {
      logger.error('LLM API error', { error: err.message });
      throw err;
    }
  }
}

module.exports = LLMClient;
