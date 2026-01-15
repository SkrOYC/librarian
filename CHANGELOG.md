# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-15

### Added

- **Core CLI Functionality**
  - Initial CLI implementation with Commander.js for command parsing
  - `explore` command for technology research with support for `--tech` and `--group` options
  - `list` command to display available technologies with filtering by group
  - Comprehensive help system with `-h` and `--help` flags

- **Agent System**
  - LangChain-powered ReAct agent implementation for intelligent codebase exploration
  - Dynamic system prompt construction based on selected technology/group context
  - Sandboxed tool execution within isolated working directories
  - Memory management using LangGraph with MemorySaver checkpointing

- **Repository Management**
  - Auto-clone repositories from Git before each query
  - Auto-update repositories with git pull before exploration
  - Branch support with automatic fallback to main/master
  - Organized storage structure: `{repos_path}/{group}/{technology}`

- **Tool Suite**
  - `File Listing Tool`: List files and directories within sandboxed working directory
  - `File Reading Tool`: Read file contents with support for various file types
  - `Grep Search Tool`: Search file contents using regex patterns
  - `Glob Search Tool`: Find files by name patterns using glob syntax

- **LLM Provider Support**
  - Unified model abstraction through LangChain's `initChatModel`
  - OpenAI integration via `@langchain/openai`
  - Anthropic integration via `@langchain/anthropic`
  - Google GenAI integration via `@langchain/google-genai`
  - OpenAI-compatible provider support
  - Anthropic-compatible provider support
  - CLI-based providers: Claude Code and Gemini CLI
  - Built-in OpenCode Zen integration (no API key required by default)

- **Configuration System**
  - YAML-based configuration file support
  - Configuration validation using Zod schemas
  - Environment variable support via `.env` files
  - Path expansion and normalization
  - Backward compatibility with legacy configuration keys

- **Security Features**
  - Path validation preventing directory traversal attacks
  - Sandboxed working directory isolation for all tools
  - Absolute path validation to prevent escape attempts
  - Security verification script for testing sandboxing

- **Logging System**
  - Comprehensive logging with timestamped log files
  - Sensitive information redaction (API keys, paths, URLs)
  - Multiple log levels: INFO, DEBUG, WARN, ERROR
  - Performance timing measurements
  - Silent file logging with no impact on stdout

### Changed

- **Architecture**
  - Modular structure separating CLI, core logic, agents, tools, and utilities
  - TypeScript-first development with strict type checking
  - ES module system with proper exports configuration
  - Source map generation for better debugging experience

### Dependencies

- **Core Runtime**
  - `commander`: ^14.0.2 (CLI argument parsing)
  - `yaml`: ^2.8.2 (Configuration parsing)
  - `isomorphic-git`: ^1.36.1 (Git operations)
  - `zod`: ^4.2.1 (Runtime validation)

- **Agent Framework**
  - `langchain`: ^1.2.2 (Core LangChain framework)
  - `@langchain/langgraph`: ^1.0.7 (State management)
  - `@langchain/openai`: ^1.2.0 (OpenAI integration)
  - `@langchain/anthropic`: ^1.3.2 (Anthropic integration)
  - `@langchain/google-genai`: ^2.1.2 (Google integration)

- **Development Tools**
  - `typescript`: ^5.9.3
  - `@biomejs/biome`: ^2.3.11
  - `eslint`: ^9.39.2

### Features by Category

#### Repository Management
- Auto-clone repositories on first access
- Auto-update before each query
- Custom repository path configuration
- Branch specification support
- Organized group/technology hierarchy

#### Agent Capabilities
- Intelligent codebase exploration
- Context-aware prompts
- Streaming responses
- Memory persistence across sessions
- Tool execution sandboxing

#### CLI Experience
- Interactive command parsing
- Colored output support
- Error handling with appropriate exit codes
- Configuration validation feedback
- Help text generation

#### Multi-Provider Support
- Zero-configuration OpenCode Zen integration
- OpenAI API key support
- Anthropic API key support
- Google API key support
- Custom OpenAI-compatible endpoints
- Claude CLI integration
- Gemini CLI integration

### Security

- Input validation on all configuration parameters
- Path traversal prevention
- Sandboxed file system access
- API key protection through environment variables
- Comprehensive logging without sensitive data exposure

### Installation Methods

- **NPM**: `@skroyc/librarian`
- **Bun**: `@skroyc/librarian`
- **Nix**: `nix run github:SkrOYC/librarian`
- **Source**: Manual build from GitHub repository

### System Requirements

- **Node.js**: >= 18.0.0
- **Bun**: >= 1.0.0
- **Git**: Any recent version with HTTPS/SSH support
- **Platform**: Cross-platform (Linux, macOS, Windows with WSL)

### Known Limitations

- Initial release (v0.1.0) - first public version
- Limited to Git-based repositories
- Requires network access for repository cloning
- LLM API calls require internet connectivity (except OpenCode Zen)

### Roadmap

Future versions will include:
- Support for other VCS systems (Mercurial, Subversion)
- Local caching optimization
- Additional LLM providers
- Plugin system for custom tools
- Web-based dashboard for configuration management
- Batch processing capabilities
- Export formats for research results

### Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

**Full Changelog**: https://github.com/SkrOYC/librarian/compare/v0.1.0