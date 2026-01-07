{ bun2nix, bun, ... }:

bun2nix.mkDerivation {
  pname = "librarian";
  version = "0.1.0";

  src = ./.;

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  # The entry point for the bun CLI application
  module = "src/cli.ts";
}
