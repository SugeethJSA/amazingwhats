{
  description = "A basic flake for building W4L";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;

    in {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        # D-AUD-009b: pass pkgs and the v3 CLI explicitly; no v2 fallback.
        in { default = pkgs.callPackage ./package.nix { inherit pkgs; wails3 = pkgs.wails3; }; }
      );

      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in { default = pkgs.callPackage ./shell.nix { }; }
      );

      checks = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };

          # D-AUD-009b/009g: checks must use the v3 CLI and the GTK4 /
          # WebKitGTK 6.0 stack, matching package.nix. If the pinned nixpkgs
          # predates `wails3`, add an override input / overlay that provides it
          # rather than falling back to v2 `wails`.
          wails3 = pkgs.wails3;

          writableTmpDirAsHomeHook =
            pkgs.writableTmpDirAsHomeHook or pkgs.stdenvNoCC.cc.libc.out;

          go-test = pkgs.stdenvNoCC.mkDerivation {
            name = "go-test";
            src = ./.;
            dontBuild = true;
            doCheck = true;

            nativeBuildInputs = with pkgs; [
              go
              wails3
              pkg-config
              gtk4
              webkitgtk_6_0
              libsoup_3
              writableTmpDirAsHomeHook
              fontconfig
            ];

            checkPhase = ''
              go test -v ./...
            '';

            installPhase = ''
              mkdir -p $out
            '';
          };

          go-lint = pkgs.stdenvNoCC.mkDerivation {
            name = "go-lint";
            src = ./.;
            dontBuild = true;
            doCheck = true;

            nativeBuildInputs = with pkgs; [
              golangci-lint
              go
              wails3
              pkg-config
              gtk4
              webkitgtk_6_0
              libsoup_3
              writableTmpDirAsHomeHook
              fontconfig
            ];

            checkPhase = ''
              golangci-lint run
            '';

            installPhase = ''
              mkdir -p $out
            '';
          };

        in { inherit go-test go-lint; }
      );
    };
}

