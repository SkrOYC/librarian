# Tech Stack: Librarian CLI - Technology Research Agent

## Programming Language
- **TypeScript** - Primary implementation language providing type safety and modern JavaScript ecosystem compatibility

## CLI Framework
- **Commander.js** - Popular and well-established CLI framework with TypeScript support for building the command-line interface

## AI/LLM Integration
- **LangChain** - Comprehensive framework for AI applications with multiple provider support (OpenAI, Anthropic, Google, etc.)
- **LangGraph** - For memory management with MemorySaver
- Provider-specific LangChain integrations:
  - `@langchain/openai` - OpenAI provider integration
  - `@langchain/anthropic` - Anthropic provider integration
  - `@langchain/google-genai` - Google provider integration

## Configuration Management
- **YAML** - For configuration file parsing and management
- **Zod** - For runtime validation of configuration and data structures

## Git Operations
- **isomorphic-git** - Pure JavaScript Git implementation for repository operations, avoiding native dependencies

## File System Operations
- **Node.js built-in modules** - For file system operations and path handling
- **Custom FileExplorer Tools** - Specialized tools for repository exploration (file listing, reading, content search, and file finding)

## Utilities
- **Chalk** - Terminal output formatting
- **Glob** - File pattern matching
- **Grep** - File content searching

## Development Dependencies
- **Bun** - Package manager and runtime
- **TypeScript** - Type checking and compilation