/**
 * Claude client — handles conversation with Claude API.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getSystemPrompt } = require('./system-prompt');
const { ALL_TOOLS } = require('./tools');
const { executeTool } = require('./tool-executor');
const logger = require('../../utils/logger');

class ClaudeClient {
  constructor(config) {
    this.client = new Anthropic({ apiKey: config.claude.apiKey });
    this.model = config.claude.model;
    this.maxTokens = config.claude.maxTokens;
  }

  /**
   * Process a user message and return Claude's response.
   * Handles tool use loops automatically.
   */
  async processMessage(user, conversationHistory, userId) {
    const systemPrompt = getSystemPrompt(user);
    const messages = [...conversationHistory];

    try {
      let response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        tools: ALL_TOOLS,
        messages,
      });

      // Handle tool use loops
      while (response.stop_reason === 'tool_use') {
        const toolResults = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            logger.info('Tool call', { tool: block.name, args: block.input });

            try {
              const result = await executeTool(block.name, block.input, userId);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result),
              });
            } catch (err) {
              logger.error('Tool execution failed', { tool: block.name, error: err.message });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ error: err.message }),
                is_error: true,
              });
            }
          }
        }

        // Add assistant response + tool results to conversation
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        // Get next response
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          tools: ALL_TOOLS,
          messages,
        });
      }

      // Extract text response
      const textBlocks = response.content.filter(b => b.type === 'text');
      const responseText = textBlocks.map(b => b.text).join('\n');

      return {
        text: responseText,
        usage: response.usage,
      };
    } catch (err) {
      logger.error('Claude API error', { error: err.message });
      throw err;
    }
  }
}

module.exports = ClaudeClient;
