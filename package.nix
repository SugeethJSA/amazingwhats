{
  lib,
  pkgs,
  version ? "0.0.1",
  makeWrapper,
  buildGoModule,
  buildNpmPackage,
  pkg-config,
  # D-AUD-009b: Wails v3 CLI only - there is intentionally no v2 `wails`
  # fallback. If the pinned nixpkgs does not provide `wails3`, pass a v3 CLI
  # derivation explicitly (overlay / override input, or `wails3 = <drv>` at
  # the callPackage site) instead of falling back to the v2 package.
  wails3 ? pkgs.wails3,
  gtk4,
  pango,
  glib,
  harfbuzz,
  atk,
  cairo,
  gdk-pixbuf,
  zlib,
  fontconfig,
  webkitgtk_6_0,
  libsoup_3,
  nodejs_latest,
}:

let
frontend = buildNpmPackage {
    pname = "whats4linux-frontend";
    inherit version;
    
    src = ./frontend;
    
    npmDepsHash = "sha256-IUzpbPrNFdhWGQL/e9gNRlhZmR6L8ZYJKdB8VRHCViY=";
    
    buildPhase = ''
      # runHook preBuild
      
      # Fix shebang lines for all node executables
      find node_modules/.bin -type f -exec sed -i 's|#!/usr/bin/env node|#!${nodejs_latest}/bin/node|g' {} \; || true

      # Run TypeScript and Vite directly instead of npm script
      ${nodejs_latest}/bin/node node_modules/typescript/bin/tsc && ${nodejs_latest}/bin/node node_modules/vite/bin/vite.js build
      # runHook postBuild
    '';
    
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r dist $out/
      # D-AUD-009c: expose node_modules so the sandbox build never needs to
      # reach the npm registry when the Taskfile installs frontend deps.
      cp -r node_modules $out/
      runHook postInstall
    '';
  };
in
buildGoModule {
  pname = "whats4linux";
  inherit version;
  
  src = ./.;
  
  vendorHash = "sha256-83Ht02V6N6F2E0Sf1+Z3v3Dc4o8b8BYKTDCSYdEfzXY=";
  
  proxyVendor = true;
  
  subPackages = [ ]; # this defaults to "."
  doBuild = false; 
  
  # v3 builds use the Taskfile, not Go build tags.
  
  nativeBuildInputs = [
    makeWrapper
    pkg-config
    wails3
    nodejs_latest
  ];
  
  buildInputs = [
    gtk4.dev
    pango.dev
    glib.dev
    harfbuzz.dev
    atk.dev
    cairo.dev
    gdk-pixbuf.dev
    zlib.dev
    fontconfig.dev
    webkitgtk_6_0.dev
    libsoup_3.dev
  ];
  
  # Build frontend first
  preBuild = ''
    # D-AUD-009c: copy pre-built assets AND node_modules into the source tree.
    # The Taskfile's install:frontend:deps task then sees node_modules already
    # present and skips `npm install`, keeping the Nix sandbox network-free.
    cp -r ${frontend}/dist frontend/
    rm -rf frontend/node_modules
    cp -r ${frontend}/node_modules frontend/

    # Set up a proper home directory for binding generation
    export HOME=$(mktemp -d)

    # v3 build system: Taskfile-driven, GTK4/WebKitGTK6 by default.
    # v3 output is ./bin, not the v2 ./build/bin.
    wails3 build PRODUCTION=true
  '';

  buildPhase = "runHook preBuild"; # no `go build`

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/lib
    [ -f bin/whats4linux ] && cp bin/whats4linux $out/bin/ || true
    [ -d bin/lib ] && cp bin/lib/* $out/lib/ || true

    runHook postInstall
  '';
  
  postFixup = ''
    # Wrap the binary with required library paths
    wrapProgram $out/bin/whats4linux \
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [
        gtk4
        webkitgtk_6_0
        libsoup_3
      ]}" \
      --prefix PKG_CONFIG_PATH : "${lib.concatStringsSep ":" [
        "${gtk4.dev}/lib/pkgconfig"
        "${webkitgtk_6_0.dev}/lib/pkgconfig"
        "${pango.dev}/lib/pkgconfig"
        "${glib.dev}/lib/pkgconfig"
        "${harfbuzz.dev}/lib/pkgconfig"
        "${atk.dev}/lib/pkgconfig"
        "${cairo.dev}/lib/pkgconfig"
        "${gdk-pixbuf.dev}/lib/pkgconfig"
        "${libsoup_3.dev}/lib/pkgconfig"
        "${zlib.dev}/lib/pkgconfig"
        "${fontconfig.dev}/lib/pkgconfig"
      ]}"
  '';
  
  meta = {
    homepage = "https://github.com/lugvitc/whats4linux";
    description = "An unofficial WhatsApp client for Linux";
    license = lib.licenses.agpl3Plus;
    maintainers = with lib.maintainers; [
      zstg
    ];
    platforms = lib.platforms.linux;
    mainProgram = "whats4linux";
  };
}
