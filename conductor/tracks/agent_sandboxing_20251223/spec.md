# Specification: Agent Directory Sandboxing with contextSchema

## Overview
Implement directory-based sandboxing for the Librarian CLI's ReAct agent using LangChain's `contextSchema` and `ToolRuntime` primitives. This ensures that all file operations performed by the agent are securely isolated to a specific technology's repository directory, preventing unauthorized access to other parts of the filesystem.

## Background
The current implementation does not enforce sandboxing boundaries, which poses security risks when AI agents explore repositories. By leveraging LangChain's static runtime context, we can inject the working directory at agent invocation time and have tools access it through `ToolRuntime`, providing a clean, testable, and thread-safe approach.

## Functional Requirements

### 1. Context Schema Definition
- Define a comprehensive Zod schema for the agent's context including:
  - `workingDirectory: string` - The absolute path to the sandbox directory
  - `environment: string` - Optional environment identifier
  - `group: string` - The technology group name
  - `technology: string` - The technology/repo name

### 2. React Agent Modification
- Update the ReAct agent implementation to accept a `contextSchema` parameter
- Modify agent invocation to pass the context object with resolved working directory

### 3. CLI Invocation Layer
- Modify CLI command handlers to calculate the working directory path based on `{reposPath}/{group}/{technology}` configuration
- Pass the computed context when invoking the agent

### 4. File Explorer Tools
- Update all File Explorer tools to accept a `ToolRuntime` parameter
- Extract `workingDirectory` from `runtime.context` in each tool
- Implement path resolution using `path.resolve(workingDirectory, relativePath)` for all file operations

### 5. Security Enforcement
- Implement validation using `path.relative(workingDirectory, resolvedPath)` in each tool
- Reject any paths where the relative path starts with `..` (directory traversal attempt)
- Throw descriptive error messages when sandbox boundaries are violated

## Non-Functional Requirements

### Security
- All file operations must be confined to the specified working directory
- No tools should accept absolute paths from LLM inputs
- Directory traversal attacks must be prevented

### Code Quality
- Maintain >80% code coverage for all modified components
- Follow existing TypeScript and coding standards
- Ensure type safety with proper Zod schema typing

### Performance
- Path resolution and validation should have minimal overhead
- No significant performance degradation in agent execution

## Acceptance Criteria

1. When invoking the agent for a specific technology, all file operations are confined to that technology's repository directory
2. Attempting to access files outside the sandbox directory (e.g., using `../../etc/passwd`) results in a clear error message
3. Tools correctly resolve relative paths against the working directory
4. Context with proper working directory is passed to the agent on every invocation
5. All existing tests pass, and new tests cover sandboxing behavior
6. Code coverage remains above 80% for modified modules

## Out of Scope

- Middleware-based sandboxing (not using core primitives)
- Multi-directory sandboxing within a single agent invocation
- Temporary directory creation or management
- Path normalization for symlinks (basic resolution only)

## Technical Implementation Notes

### Context Schema Structure
```typescript
const contextSchema = z.object({
  workingDirectory: z.string(),
  environment: z.string().optional(),
  group: z.string(),
  technology: z.string(),
});
```

### Path Resolution Pattern
```typescript
const workingDir = runtime.context.workingDirectory;
const fullPath = path.resolve(workingDir, userPath);
const relativePath = path.relative(workingDir, fullPath);

if (relativePath.startsWith('..')) {
  throw new Error("Access denied: path outside sandbox directory");
}
```

### Tools to Update
- `src/tools/file-listing.tool.ts`
- `src/tools/file-reading.tool.ts`
- `src/tools/file-finding.tool.ts`
- `src/tools/grep-content.tool.ts`
