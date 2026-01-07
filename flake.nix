{
  description = "Librarian CLI - Technology Research Agent";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    systems.url = "github:nix-systems/default";

    bun2nix.url = "github:nix-community/bun2nix?tag=2.0.6";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
    bun2nix.inputs.systems.follows = "systems";
  };

  outputs =
    inputs:
    let
      # Read each system from nix-systems input
      eachSystem = inputs.nixpkgs.lib.genAttrs (import inputs.systems);

      # Access package set for a given system
      pkgsFor = eachSystem (
        system:
        import inputs.nixpkgs {
          inherit system;
          # Use bun2nix overlay, which puts `bun2nix` in pkgs
          overlays = [ inputs.bun2nix.overlays.default ];
        }
      );
    in
    {
      packages = eachSystem (system: {
        # Produce the librarian executable package
        default = pkgsFor.${system}.callPackage ./default.nix { };

        # Also expose the executable for direct use
        executable = pkgsFor.${system}.callPackage ./default.nix { };
      });

      apps = eachSystem (system: {
        # Allow running with nix run
        default = {
          type = "app";
          program = "${pkgsFor.${system}.callPackage ./default.nix { }}/bin/librarian";
        };
      });

      devShells = eachSystem (system: {
        default = pkgsFor.${system}.mkShell {
          packages = with pkgsFor.${system}; [
            bun

            # Add bun2nix binary to our devshell
            # Optional now that we have a binary on npm
            bun2nix
          ];

          shellHook = ''
            bun install --frozen-lockfile
          '';
        };
      });
    };
}
