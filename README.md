# Librarian CLI - Technology Research Agent

A powerful CLI tool that enables AI coding agents to query specific technology repositories and receive detailed technical responses through autonomous exploration.

## Overview

Librarian CLI allows AI coding agents to:

- Query specific technology repositories with detailed technical questions
- Receive autonomous exploration through a ReAct agent that reads and analyzes the codebase
- Get streaming markdown responses with technical insights and explanations
- Works out-of-the-box with OpenCode Zen (no LLM configuration required by default)
- Supports multiple LLM providers through LangChain's unified interface

## Features

- **Repository Management**: Auto-clone and sync from Git before each query
- **LangChain-Powered Agent**: Advanced AI agent using LangChain's createAgent for intelligent exploration
- **Unified Model Abstraction**: Support for OpenAI, Anthropic, Google, OpenAI-compatible, Anthropic-compatible, Claude CLI, and Gemini CLI APIs through LangChain (OpenCode Zen integration - no LLM required by default)
- **Dynamic Prompt Construction**: Context-aware system prompts based on technology/group selection
- **Sandboxed Tool Execution**: Secure file operations within isolated working directories
- **Integrated Toolset**: Built-in tools for file listing, reading, grep, and glob search
- **Grouped Technologies**: Organize tech stacks by groups (default, langchain, etc.)
- **Streamlined CLI**: Simple commands for exploration and listing available technologies
- **Robust Configuration**: YAML-based config with validation and path resolution

## Installation

### Quick Try

```bash
# Build and run directly with Nix
nix run github:SkrOYC/librarian -- --help
```

### Bun Installation

```bash
# Install globally
bun add -g librarian-cli

# Or install locally
bun add librarian-cli
```

### Nix Installation

This project supports building with Nix using [bun2nix](https://github.com/nix-community/bun2nix).

#### Prerequisites

Ensure you have Nix with flakes enabled:

```bash
# Add to ~/.config/nix/nix.conf or /etc/nix/nix.conf
experimental-features = nix-command flakes
```

#### Option 1: NixOS System-wide

Add the librarian flake to your system configuration:

```nix
# In your /etc/nixos/flake.nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    librarian.url = "github:SkrOYC/librarian";
  };

  outputs = inputs: {
    # ... your existing nixosConfiguration ...
    nixosConfigurations.yourhost = inputs.nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        # Your existing modules
        ({ pkgs, ... }: {
          nixpkgs.overlays = [ inputs.librarian.overlays.default ];
          environment.systemPackages = [ pkgs.librarian ];
        })
      ];
    };
  };
}
```

Then rebuild:
```bash
sudo nixos-rebuild switch
```

#### Option 2: Home Manager (Recommended for multi-user systems)

Add to your Home Manager configuration:

```nix
# In ~/.config/nixpkgs/home.nix or within your home-manager module
{ inputs, pkgs, ... }:

{
  home = {
    packages = [ pkgs.librarian ];
  };

  # Or if using flake-based Home Manager
  programs.home-manager.enable = true;
  home-manager.users.youruser = { pkgs, ... }: {
    home.packages = [ pkgs.librarian ];
  };
}
```

With flakes:
```nix
# In your home-manager flake
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    home-manager.url = "github:nix-community/home-manager";
    librarian.url = "github:SkrOYC/librarian";
  };

  outputs = inputs: {
    homeManagerModules = {
      my-home = { pkgs, ... }: {
        home.packages = [ pkgs.librarian ];
      };
    };
  };
}
```

Then:
```bash
home-manager switch
```

#### Option 3: nix profile (User-wide, any Linux/macOS)

Install to your user profile:

```bash
# Install latest version
nix profile install github:SkrOYC/librarian

# Or pin to a specific version
nix profile install github:SkrOYC/librarian?ref=v0.1.0

# Update
nix profile upgrade librarian

# List installed packages
nix profile list

# Remove
nix profile remove librarian
```

#### Option 4: Flake Overlay (For your own flakes)

Use librarian as an overlay in your flake:

```nix
# In your flake.nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    librarian.url = "github:SkrOYC/librarian";
  };

  outputs = inputs: {
    packages = inputs.nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ] (system: {
      default = import inputs.nixpkgs {
        inherit system;
        overlays = [ inputs.librarian.overlays.default ];
      }.librarian;
    });
  };
}
```

#### Building from Source

```bash
# Build the package (requires Nix flakes enabled)
nix build .#default

# The binary will be at ./result/bin/librarian
./result/bin/librarian --help
```

#### Darwin/macOS Support

Librarian supports macOS on both x86_64 and Apple Silicon:

```bash
# Run directly
nix run github:SkrOYC/librarian -- --help

# Install to profile
nix profile install github:SkrOYC/librarian
```

Note: Full system installation on macOS requires [nix-darwin](https://github.com/LnL7/nix-darwin):

## Quick Start

### 1. Configure Technologies

Create a configuration file at `~/.config/librarian/config.yaml`:

```yaml
repos_path: "~/.local/share/librarian/repos"
technologies:
	default:
		react:
			repo: "https://github.com/facebook/react.git"
			# Branch must be optional
			branch: "main"
			description: "JavaScript library for building user interfaces"
		nodejs:
			repo: "https://github.com/nodejs/node.git"
			branch: "main"
			description: "JavaScript runtime environment"
	langchain:
		langchain-javascript:
			repo: "https://github.com/langchain-ai/langchainjs"
			description: "LangChain is a framework for building LLM-powered..."
		langgraph-javascript:
			repo: "https://github.com/langchain-ai/langgraphjs"
			description: "LangGraph is low-level orchestration framework..."
# Optional: Uncomment and configure LLM provider if you want to override OpenCode Zen
# aiProvider:
#   type: openai # Options: openai, anthropic, google, openai-compatible, anthropic-compatible, claude-code, gemini-cli
#   apiKey: # API key (loaded from .env as LIBRARIAN_API_KEY if not provided)
#   model: gpt-5.2
#   baseURL: # Optional for openai-compatible providers
```

### 2. Explore a Technology

```bash
# Query an specific tech
librarian explore "How does React handle state management?" --tech react

# Query a whole group (all technologies under it)
librarian explore "How does LangChain handle memory management?" --group langchain
```

### 3. List Available Technologies

```bash
# List all technologies
librarian list
# Returns this:
# group
# 	tech1: description
# 	tech2: description
# e.g.:
# default
# 	react: JavaScript library for building user interfaces
# 	nodejs: JavaScript runtime environment
# langchain
# 	langchain-javascript: LangChain is a framework for building...
# 	langgraph-javascript: LangGraph is low-level orchestration framework...

# List technologies in a specific group
librarian list --group langchain
# Returns this:
# langchain
# 	langchain-javascript: LangChain is a framework for building...
# 	langgraph-javascript: LangGraph is low-level orchestration framework...
```

## Commands

### `explore <query> --tech <technology>`

Execute agentic research on specified technology using a LangChain-powered agent. The agent operates in a sandboxed environment at `{repos_path}/{group}/{technology}` and streams the response to stdout.

**Options:**

- `--tech, -t <technology>`: Technology name

**Examples:**

```bash
librarian explore "Explain the virtual DOM implementation" --tech react
librarian explore "How are errors handled in this codebase?" --tech default:nodejs
```

### `explore <query> --group <group>`

Execute agentic research on whole group using a LangChain-powered agent. The agent operates in a sandboxed environment at `{repos_path}/{group}` with access to all technologies in the group.

**Options:**

- `--group, -g <group>`: Group name

**Examples:**

```bash
librarian explore "What are common patterns across React libraries?" --group default
librarian explore "What are middlewares in the langchain ecosystem?" --group langchain
```

### `list --group [group]`

List available technologies with descriptions.

**Options:**

- `--group, -g [group]`: Filter by technology group (default: all groups)

**Examples:**

```bash
librarian list
librarian list --group langchain
```

### `--help/-h`

Display help information for all commands.

## Configuration

### Configuration File Location

The configuration file must be located at `~/.config/librarian/config.yaml`.

### Configuration Schema

```yaml
repos_path: "~/.local/share/librarian/repos" # Shared directory for all technologies
technologies:
  default: # Default group
    react:
      repo: "https://github.com/facebook/react.git"
      branch: "main" # Optional, defaults to main/master
      description: "JavaScript library for building user interfaces"
    nodejs:
      repo: "https://github.com/nodejs/node.git"
      branch: "main"
      description: "JavaScript runtime environment"
  langchain: # Custom group
    langchain-javascript:
      repo: "https://github.com/langchain-ai/langchainjs"
      description: "LangChain is a framework for building LLM-powered applications..."
    langgraph-javascript:
      repo: "https://github.com/langchain-ai/langgraphjs"
      description: "LangGraph is low-level orchestration framework..."
# Optional: Uncomment and configure LLM provider if you want to override OpenCode Zen
# aiProvider:
#   type: openai # Options: openai, anthropic, google, openai-compatible, anthropic-compatible, claude-code, gemini-cli
#   apiKey: # API key (loaded from .env as LIBRARIAN_API_KEY if not provided)
#   model: gpt-5.2
#   baseURL: # Optional for openai-compatible providers
```

**Note**: The system works out-of-the-box with OpenCode Zen integration (no LLM configuration required by default). When configured, the system supports multiple providers through LangChain's unified interface.

### Repository Path Structure

Repositories are cloned to: `{repos_path}/{group}/{technology}`

**Agent Working Directory Sandboxing:**

- For `--tech` commands: Agent operates in `{repos_path}/{group}/{technology}`
- For `--group` commands: Agent operates in `{repos_path}/{group}`

This ensures all file paths are relative to the target directory and tool execution is securely isolated.

Example:

- `~/.local/share/librarian/repos/default/react/` (single tech exploration)
- `~/.local/share/librarian/repos/langchain/` (group-wide exploration)

## Architecture

### Core Components

1. **CLI Entry Point** (`src/cli.ts`)
   - Command parsing with Commander.js
   - Configuration loading and validation
   - Error handling and exit codes

2. **Core Librarian** (`src/index.ts`)
   - Main class for orchestrating operations
   - Technology resolution
   - Repository synchronization logic

3. **Repository Manager** (`src/repo/`)
   - Git clone/pull operations
   - Repository synchronization
   - Local path management

4. **Agent Orchestrator** (`src/agent/`)
   - LangChain createAgent-based implementation
   - Dynamic system prompt construction based on group/tech context
   - Tool integration with sandboxed execution environment
   - Memory management with LangGraph

5. **LLM Provider** (`src/llm/`)
   - LangChain unified model abstraction through `initChatModel`
   - Multi-provider support via LangChain integrations
   - Dynamic model switching without code changes
   - Response streaming and structured output handling

### Agent Tools

The Librarian agent includes four core tools for repository exploration:

- **File Listing**: List files and directories within the sandboxed working directory
- **File Reading**: Read file contents with support for various file types
- **Grep Search**: Search file contents using regex patterns
- **Glob Search**: Find files by name patterns using glob syntax

All tools operate within the agent's isolated working directory, ensuring secure and context-aware file operations.

## Technology Management

### Adding New Technologies

1. Edit your `~/.config/librarian/config.yaml` file
2. Add your technology under the appropriate group
3. Specify the GitHub repository URL, branch, and description
4. Ensure the technology name is unique within its group

### Repository Management

- **Auto-Clone**: Repositories are automatically cloned when first accessed
- **Auto-Update**: Repositories are pulled for updates before each query
- **Path Resolution**: Repositories follow the pattern `{repos_path}/{group}/{technology}`
- **Branch Support**: Specify any branch (defaults to main/master if not specified)

## LLM Provider Configuration

Librarian uses LangChain's unified model abstraction and works out-of-the-box with OpenCode Zen (no LLM configuration required by default). Seamless switching between providers is possible through configuration. No code changes required when changing models.

By default, the system uses OpenCode Zen:

```yaml
aiProvider:
  type: openai-compatible
  model: grok-code
  baseURL: "https://opencode.ai/zen/v1"
```

### OpenAI

```yaml
aiProvider:
  type: openai
  apiKey: # API key (loaded from .env as LIBRARIAN_API_KEY if not provided)
  model: gpt-5.2
```

### Anthropic

```yaml
aiProvider:
  type: anthropic
  apiKey: # API key (loaded from .env as LIBRARIAN_API_KEY if not provided)
  model: claude-opus-4-5-20251101
```

### Google

```yaml
aiProvider:
  type: google
  apiKey: # API key (loaded from .env as LIBRARIAN_API_KEY if not provided)
  model: gemini-3-pro-preview
```

### OpenAI-Compatible

```yaml
aiProvider:
  type: openai-compatible
  model: your-model-name
  baseURL: "https://your-provider.com/v1"
  apiKey: # Optional API key (loaded from .env as LIBRARIAN_API_KEY if required by provider)
```

### Anthropic-Compatible

```yaml
aiProvider:
  type: anthropic-compatible
  model: your-model-name
  baseURL: "https://your-anthropic-compatible-provider.com/v1"
  apiKey: # API key (loaded from .env as LIBRARIAN_API_KEY if not provided)
```

### Claude Code (CLI-based)

```yaml
aiProvider:
  type: claude-code
  model: claude-sonnet-4-5 # Model name passed to Claude CLI
```

**Note**: For Claude Code provider, ensure the `claude` CLI is installed and available in your PATH.

### Gemini CLI (CLI-based)

```yaml
aiProvider:
  type: gemini-cli
  model: gemini-3-pro-preview # Model name passed to Gemini CLI
```

**Note**: For Gemini CLI provider, ensure the `gemini` CLI is installed and available in your PATH.

**Note**: The same configuration interface works across all providers thanks to LangChain's `initChatModel` abstraction and OpenCode Zen integration.

## Error Handling

- **Fatal Errors**: CLI exits with appropriate error codes
- **Repository Issues**: Clear error messages for missing or inaccessible repositories
- **LLM Errors**: Graceful handling of API failures and rate limits
- **Configuration Errors**: Validation errors with helpful guidance

## Development

### Project Setup

```bash
# Clone the repository
git clone https://github.com/SkrOYC/librarian.git
cd librarian

# Install dependencies
bun install

# Build the project
bun run build

# Run tests
bun run test
```

### Dependencies

#### Core

- `commander`: CLI argument parsing
- `yaml`: Configuration file parsing
- `isomorphic-git`: Git operations
- `zod`: Runtime validation

#### Agent System

- `langchain`: Core LangChain framework (createAgent, initChatModel, tool)
- `@langchain/langgraph`: Memory management with MemorySaver
- `@langchain/openai`: OpenAI provider integration
- `@langchain/anthropic`: Anthropic provider integration
- `@langchain/google-genai`: Google provider integration
- `zod`: Tool schema validation and structured responses

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

Apache 2.0

## Support

For support and questions:

- Create an issue on GitHub
