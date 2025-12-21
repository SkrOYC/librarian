# Initial Concept

Based on the README.md file, this is the Librarian CLI - Technology Research Agent. It's a powerful CLI tool that enables AI coding agents to query specific technology repositories and receive detailed technical responses through autonomous exploration.

Key aspects:
- Query specific technology repositories with detailed technical questions
- Receive autonomous exploration through a ReAct agent that reads and analyzes the codebase
- Get streaming markdown responses with technical insights and explanations
- Uses specialized FileExplorer tools for repository navigation and content analysis

Core features include repository management, LangChain-powered ReAct agent, specialized file exploration tools, unified model abstraction, and more.

# Product Guide: Librarian CLI - Technology Research Agent

## Vision
The Librarian CLI is a powerful command-line tool that enables AI coding agents to query specific technology repositories and receive detailed technical responses through autonomous exploration. Its primary purpose is to reduce hallucinations from AI coding agents by providing à la carte guidance grounded in actual source code.

## Target Audience
The primary target audience consists of software engineers who work with AI coding agents. The actual user is the AI agent itself, operating in coding environments like the current platform. The tool is designed to be used by AI coding agents throughout their entire coding lifecycle - planning and execution phases - to access direct insights of SDKs/APIs/libraries/packages so that they know for sure how to use them and integrate them.

## Goals
- Reduce hallucinations in AI coding agents by providing responses grounded in actual source code
- Enable deep repository exploration with AI-powered analysis and context-aware responses
- Provide AI agents with direct insights of SDKs/APIs/libraries/packages for accurate usage and integration information
- Support autonomous development processes where AI agents can independently access real codebase information during planning and execution
- Offer à la carte guidance that AI agents can request on-demand

## Features
- **Deep Repository Exploration**: AI-powered ReAct agent analysis that understands complex codebases and provides context-aware responses
- **Specialized FileExplorer Tools**: Dedicated tools for listing directories, reading files, searching content, and finding files by pattern to enable comprehensive codebase exploration
- **Grouped Technology Management**: Organize tech stacks by groups (default, langchain, etc.) for easier management and group-wide exploration
- **Flexible Repository Support**: Works with any Git repository, supporting branch selection and descriptions for each technology
- **Multi-Provider AI Integration**: Support for OpenAI, Anthropic, Google, and OpenAI-compatible providers through unified abstraction
- **Repository Management**: Auto-clone and sync from Git before each query to ensure up-to-date information
- **Hierarchical Sandboxing**: Securely isolated working directories structured as `{repos_path}/{group}/{technology}`
- **Streaming Responses**: Real-time markdown responses with technical insights and explanations

## Value Proposition
The Librarian CLI addresses the critical issue of AI hallucinations in coding contexts by grounding agent responses in actual source code. Rather than generating speculative answers, the tool enables AI agents to access, analyze, and reference real code from configured repositories during their entire coding lifecycle, significantly improving the accuracy and reliability of technical decisions during planning and execution phases.