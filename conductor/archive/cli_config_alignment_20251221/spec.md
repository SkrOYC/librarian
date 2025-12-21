# Configuration and CLI Alignment Specification

## Overview
This track focuses on aligning the Librarian CLI's command structure and YAML configuration with the requirements specified in the README. Currently, the implementation has a basic "query" command and a simple configuration schema, but the README describes a more sophisticated system with technology groups, explore/list commands, and advanced configuration options.

## Functional Requirements

1. **Configuration Schema Update**
   - Add support for technology groups (default, langchain, etc.) in the config structure
   - Add branch field support for repositories with default fallback to main/master
   - Add description field support for technologies
   - Add repos_path configuration setting for repository storage location
   - Change from flat repositories map to nested structure: `technologies: {group: {tech: {repo, branch, description}}}`
   - Add support for "openai-compatible" provider type in addition to existing providers

2. **CLI Command Implementation**
   - Implement "explore" command to replace the current "query" command
   - Implement "list" command to show available technologies with descriptions
   - Add --tech flag support for specifying individual technologies (format: --tech react or --tech default:nodejs)
   - Add --group flag support for specifying technology groups (format: --group langchain)

3. **Repository Path Structure**
   - For --tech commands: Agent operates in {repos_path}/{group}/{technology}
   - For --group commands: Agent operates in {repos_path}/{group}
   - Implement proper path resolution and sandboxing for both scenarios

4. **Command Behavior**
   - `librarian explore <query> --tech <technology>` should explore a specific technology
   - `librarian explore <query> --group <group>` should explore all technologies in a group
   - `librarian list` should list all technologies with descriptions grouped by technology groups
   - `librarian list --group <group>` should list technologies within a specific group

## Non-Functional Requirements

1. **Security**
   - Maintain existing path sanitization and directory traversal prevention
   - Continue to operate within the working directory sandbox
   - Ensure all path operations are properly validated

2. **Compatibility**
   - Allow breaking changes to prioritize alignment with README
   - Update all affected tests to match new interface

3. **Performance**
   - Maintain reasonable response times for both explore and list operations
   - Efficient repository path resolution

## Acceptance Criteria

1. The "explore" command successfully accepts --tech and --group flags
2. The "list" command displays technologies in the format specified in README
3. Configuration schema supports nested technology groups with branch/description fields
4. Repository path structure follows {repos_path}/{group}/{technology} pattern
5. All existing functionality can be accessed through the new interface
6. Unit tests cover the new CLI commands and configuration parsing
7. Integration tests verify the complete workflow with actual repository structures

## Out of Scope

1. Streaming responses (will be implemented in a future track)
2. Advanced dynamic prompt construction (will be implemented in a future track)
3. UI enhancements beyond CLI interface