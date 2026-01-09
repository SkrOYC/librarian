{ stdenv, bun2nix, bun, ... }:

# Build a standalone Bun executable using bun2nix for reproducible dependencies
# This creates a tiny 3-4MB binary vs 126MB with full Bun runtime
#
# We use bun2nix.mkDerivation to handle dependencies, but override the build
# to create a standalone executable with --target bun
bun2nix.mkDerivation {
  pname = "librarian";
  version = "0.1.0";

  src = ./.;

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  # Override the default build to create a standalone executable
  buildPhase = ''
    bun build --outfile librarian --target bun ./src/cli.ts
  '';
}
