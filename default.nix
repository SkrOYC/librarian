{ stdenv, bun2nix, bun, lib, ... }:

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

  # Package metadata for NixOS/FlakeHub discovery
  meta = {
    description = "Technology Research Agent for AI coding assistants";
    longDescription = ''
      Librarian CLI enables AI agents to autonomously explore technology
      repositories and provide detailed technical answers through a
      LangChain-powered ReAct agent with file listing, reading, grep, and glob tools.
    '';
    homepage = "https://github.com/SkrOYC/librarian";
    license = lib.licenses.asl20;
    maintainers = [ lib.maintainers.skroyc ];
    platforms = lib.platforms.unix;
  };

  # Expose tests for other flakes to verify
  passthru.tests = {
    # Basic test: binary responds to --help
    works = stdenv.mkDerivation {
      name = "librarian-works";
      buildCommand = ''
        export PATH="${lib.makeBinPath [ stdenv.coreutils ]}:$PATH"
        if [[ -x "${placeholder "out"}/bin/librarian" ]]; then
          ${placeholder "out"}/bin/librarian --help > /dev/null
          echo "OK"
        else
          echo "Binary not found or not executable"
          exit 1
        fi
      '';
    };
  };
}
