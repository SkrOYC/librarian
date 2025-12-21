# Modernization Track: Agent Orchestration and Streaming Implementation

## Overview

This track focuses on modernizing Librarian CLI's ReAct agent implementation to align with current LangChain patterns, implement streaming responses, and fix agent-tool communication mismatches. The current implementation uses legacy patterns from LangChain v0.1.x that, while functional, should be updated to modern patterns for maintainability and to leverage current LangChain features.

## Functional Requirements

### 1. Modern LangChain Tool Pattern Migration
- Rewrite all existing tools (FileListTool, FileReadTool, GrepContentTool, FileFindTool) to use modern `tool()` function instead of `extends Tool` class
- Replace manual JSON string parsing with structured parameters using Zod schema validation
- Ensure all tool functionality remains identical but with cleaner, more maintainable implementation
- Maintain security measures (path validation, sandboxing, error handling)

### 2. Streaming Response Implementation
- Replace synchronous `agent.invoke()` calls with `agent.stream()` for real-time response streaming
- Stream character-by-character or chunk-by-chunk output to user terminal as content is generated
- Implement proper error handling for streaming operations
- Maintain current response formatting and quality while adding streaming capability

### 3. Dynamic System Prompt Construction
- Replace hardcoded system prompt with dynamic construction based on technology context
- Simple system prompt that mentions agent's working directory and current technology being explored
- Ensure prompt clarity while providing context awareness for better agent performance

### 4. Agent-Tool Communication Fixes
- Ensure agent properly formats tool calls to work with modern tool parameter structures
- Test and validate that all tools receive correctly structured parameters from agent
- Maintain existing tool functionality while improving integration

## Non-Functional Requirements

### 1. Compatibility
- Maintain support for all current AI providers (OpenAI, Anthropic, Google, OpenAI-compatible)
- Ensure no breaking changes to configuration schema or existing user setups
- Preserve backward compatibility where possible during transition

### 2. Performance
- Streaming should not significantly increase response latency
- Tool execution should remain efficient with minimal overhead
- Memory usage should remain stable during streaming operations

### 3. Security
- Maintain existing path traversal prevention and directory sandboxing
- Preserve all input validation and security checks in modernized tools
- Ensure no new attack vectors introduced during modernization

## Acceptance Criteria

1. All four tools (FileListTool, FileReadTool, GrepContentTool, FileFindTool) successfully rewritten using modern `tool()` pattern with Zod schema validation
2. Streaming response implementation working with `agent.stream()` providing real-time output to user
3. Dynamic system prompt construction that adapts based on working directory context
4. All integration tests passing without mocking of ReactAgent class (test real agent-tool communication)
5. Configuration and provider integration remain unchanged from user perspective
6. No breaking changes to existing CLI commands or workflow
7. Security measures preserved and functioning correctly
8. All existing unit tests passing after modernization

## Out of Scope

1. LangGraph memory management integration (not currently implemented, can be separate future track)
2. Group-level exploration improvements (current placeholder approach acceptable)
3. New tool functionality beyond modernization of existing tools
4. Configuration schema changes or new AI provider additions
5. Performance optimizations beyond streaming implementation
6. UI/UX improvements to CLI commands

## Implementation Notes

### Tool Modernization Strategy
- Each tool should be rewritten individually to maintain clear, focused changes
- Maintain identical functionality while improving code quality and maintainability
- Use Zod for input validation and type safety
- Preserve all security measures and error handling patterns

### Streaming Implementation Strategy  
- Replace `await this.agent.invoke()` with appropriate streaming pattern
- Handle stream chunks and format output properly for terminal display
- Maintain backward compatibility with non-streaming fallback option if needed

### Testing Strategy
- Create integration tests that validate real agent-tool communication
- Test streaming functionality with mock providers to validate user experience
- Ensure all tools work correctly with modern LangChain patterns