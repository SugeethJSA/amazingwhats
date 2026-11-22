# Used PURELY for convenience (package.nix)
let
  pkgs = import <nixpkgs> { };
in
  # D-AUD-009b: wails3 (the v3 CLI) comes from pkgs; there is no v2 fallback.
  pkgs.callPackage ./package.nix {
    inherit pkgs;
    wails3 = pkgs.wails3;
  }
