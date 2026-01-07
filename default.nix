{ bun2nix, lib, ... }:

let
  # Build the executable
  librarianExecutable = bun2nix.mkDerivation {
    pname = "librarian";
    version = "0.1.0";

    src = ./.;

    bunDeps = bun2nix.fetchBunDeps {
      bunNix = ./bun.nix;
    };

    # Skip the normal bun build, we handle it ourselves
    dontConfigure = true;
    dontBuildBun = true;

    buildPhase = ''
      export HOME=$TMPDIR
      bun install --frozen-lockfile

      # Build the standalone executable
      bun build --compile --outfile $out/bin/librarian ./src/cli.ts
    '';

    # Make it executable
    dontPatchShebangs = true;
  };
in
librarianExecutable
