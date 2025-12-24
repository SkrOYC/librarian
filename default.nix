{ bun2nix, ... }:

bun2nix.mkDerivation {
  pname = "librarian";
  version = "0.1.0";

  src = ./.;

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  module = "src/cli.ts";
}
