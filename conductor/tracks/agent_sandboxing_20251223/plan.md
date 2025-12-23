# Implementation Plan: Agent Directory Sandboxing with contextSchema

## Phase 1: Setup and Preparation [checkpoint: cf82dfd]

- [x] Task: Review current architecture and identify all files requiring changes
  - [x] Examine `src/agents/react-agent.ts` to understand current agent implementation
  - [x] Review all File Explorer tools in `src/tools/` directory
  - [x] Analyze CLI command handlers in `src/cli.ts` for invocation patterns
  - [x] Document the current tool signatures and invocation flow

- [x] Task: Create comprehensive test coverage plan
  - [x] List all existing tests related to agents and tools
  - [x] Identify gaps in test coverage for sandboxing behavior
  - [x] Define test scenarios for security enforcement (directory traversal attempts)
  - [x] Document expected behavior for group-level vs tech-level sandboxing

- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Context Schema Definition and Type Infrastructure [checkpoint: 0684a70]

- [x] Task: Define contextSchema Zod schema
  - [x] Create `workingDirectory`, `environment`, `group`, `technology` fields with proper types
  - [x] Add optional fields where appropriate
  - [x] Document the schema in JSDoc comments
  - [x] Write unit tests for schema validation

- [x] Task: Update TypeScript types for ToolRuntime with context
  - [x] Define type alias or interface for tool runtime context
  - [x] Export types for use across tools and agent
  - [x] Ensure proper typing for `runtime.context` access

- [x] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: React Agent Implementation

- [x] Task: Write tests for React Agent with contextSchema support
  - [x] Test that agent accepts contextSchema parameter during creation
  - [x] Test that agent invocation requires context parameter
  - [x] Test that context is properly passed to tools through ToolRuntime
  - [x] Test error handling when context is missing or invalid

- [x] Task: Implement contextSchema in React Agent
  - [x] Add contextSchema parameter to agent creation function
  - [x] Modify agent invocation to accept and pass context object
  - [x] Ensure context is properly typed and validated
  - [x] Add JSDoc documentation for context parameter

- [x] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: CLI Invocation Layer Updates

- [x] Task: Write tests for CLI working directory resolution [6b7d3c5]
  - [x] Test path resolution for group-level operations
  - [x] Test path resolution for tech-level operations
  - [x] Test with various repository configurations
  - [x] Test error handling for missing groups/technologies

- [~] Task: Implement working directory calculation in CLI
  - [x] Add function to resolve working directory from config (reposPath + group + technology)
  - [x] Update CLI command handlers to calculate working directory
  - [x] Construct context object with resolved working directory, group, technology
  - [x] Pass context to agent invocation

- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)

## Phase 5: File Explorer Tools Sandboxing

- [ ] Task: Write tests for file-listing tool sandboxing
  - [ ] Test that paths are resolved relative to working directory
  - [ ] Test that directory traversal attempts are rejected
  - [ ] Test that valid paths within sandbox are accepted
  - [ ] Test with edge cases (empty paths, root directory, nested paths)

- [ ] Task: Implement sandboxing in file-listing tool
  - [ ] Add ToolRuntime parameter to tool function
  - [ ] Extract workingDirectory from runtime.context
  - [ ] Implement path resolution with path.resolve()
  - [ ] Implement security validation with path.relative()
  - [ ] Throw error for directory traversal attempts

- [ ] Task: Write tests for file-reading tool sandboxing
  - [ ] Test that file reads are confined to working directory
  - [ ] Test security validation for path traversal
  - [ ] Test valid file reads within sandbox
  - [ ] Test error messages for unauthorized access

- [ ] Task: Implement sandboxing in file-reading tool
  - [ ] Add ToolRuntime parameter to tool function
  - [ ] Extract workingDirectory from runtime.context
  - [ ] Implement path resolution and security validation
  - [ ] Apply sandboxing to file read operations

- [ ] Task: Write tests for file-finding tool sandboxing
  - [ ] Test pattern matching within sandbox only
  - [ ] Test that results outside sandbox are excluded
  - [ ] Test security validation

- [ ] Task: Implement sandboxing in file-finding tool
  - [ ] Add ToolRuntime parameter to tool function
  - [ ] Extract workingDirectory from runtime.context
  - [ ] Implement path resolution for pattern matching
  - [ ] Apply security validation to all found paths

- [ ] Task: Write tests for grep-content tool sandboxing
  - [ ] Test that grep operations only search within sandbox
  - [ ] Test security validation for path arguments
  - [ ] Test results are from sandbox only

- [ ] Task: Implement sandboxing in grep-content tool
  - [ ] Add ToolRuntime parameter to tool function
  - [ ] Extract workingDirectory from runtime.context
  - [ ] Implement path resolution and validation
  - [ ] Apply sandboxing to grep search operations

- [ ] Task: Conductor - User Manual Verification 'Phase 5' (Protocol in workflow.md)

## Phase 6: Integration Testing and Verification

- [ ] Task: Write integration tests for end-to-end sandboxing
  - [ ] Test complete flow: CLI → Agent invocation → Tool execution with sandboxing
  - [ ] Test group-level queries are sandboxed to group directory
  - [ ] Test tech-level queries are sandboxed to specific tech directory
  - [ ] Test various attack vectors (../../../etc/passwd, absolute paths, etc.)

- [ ] Task: Run full test suite and ensure >80% coverage
  - [ ] Execute all unit tests
  - [ ] Execute all integration tests
  - [ ] Generate coverage report
  - [ ] Verify coverage exceeds 80% for modified modules

- [ ] Task: Manual verification of sandboxing behavior
  - [ ] Test librarian CLI query against a specific technology
  - [ ] Verify all operations stay within that technology's directory
  - [ ] Attempt directory traversal and confirm error message
  - [ ] Verify context is properly logged and passed

- [ ] Task: Conductor - User Manual Verification 'Phase 6' (Protocol in workflow.md)

## Phase 7: Documentation and Cleanup

- [ ] Task: Update JSDoc documentation for all modified files
  - [ ] Document contextSchema usage in agent
  - [ ] Document ToolRuntime parameter in each tool
  - [ ] Document security enforcement patterns
  - [ ] Add usage examples in comments

- [ ] Task: Verify linting and type checking
  - [ ] Run TypeScript type checking
  - [ ] Run linter and fix any issues
  - [ ] Ensure no type errors or warnings

- [ ] Task: Conductor - User Manual Verification 'Phase 7' (Protocol in workflow.md)
