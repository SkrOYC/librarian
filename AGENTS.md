# Agent Learnings

This document captures key learnings from agent sessions to help future work on this project.

## Nix Flake and bun2nix Configuration

### Building a Bun CLI with bun2nix

To build a Bun CLI application into a standalone executable using bun2nix:

1. **In `flake.nix`**: Pass both `bun2nix` and `bun` from the overlay to your derivation:
   ```nix
   default = pkgsFor.${system}.callPackage ./default.nix {
     bun2nix = pkgsFor.${system}.bun2nix;
     bun = pkgsFor.${system}.bun;
   };
   ```

2. **In `default.nix`**: Use `bun2nix.mkDerivation` with the `module` parameter:
   ```nix
   { bun2nix, bun, ... }:
   
   bun2nix.mkDerivation {
     pname = "librarian";
     version = "0.1.0";
   
     src = ./.;
   
     bunDeps = bun2nix.fetchBunDeps {
       bunNix = ./bun.nix;
     };
   
     module = "src/cli.ts";
   }
   ```

**Key Points**:
- The bun2nix overlay places `bun2nix` (with `mkDerivation`, `fetchBunDeps`, etc.) into `pkgs`. Access it via `pkgs.bun2nix`.
- Use `module` to specify the entry point for your CLI application.
- The `bunDeps` with `fetchBunDeps` handles npm dependencies reproducibly.

### Documentation Links

- [Bun2Nix Documentation](https://nix-community.github.io/bun2nix/)
- [Bun Executables](https://bun.com/docs/bundler/executables)
- [Bun2Nix mkDerivation](https://nix-community.github.io/bun2nix/building-packages/mkDerivation.html)
