#!/bin/bash
# One-shot APK build for STARFALL. Run from android/:  ./build.sh
# Bundles the web game (index.html + css/ + js/) into an offline WebView shell.
# Builds only — never touches the game source.
set -e
cd "$(dirname "$0")"
if [ -d "$HOME/jdk17" ]; then
  export JAVA_HOME="$HOME/jdk17" PATH="$HOME/jdk17/bin:$PATH"
fi
: "${ANDROID_SDK_ROOT:=$HOME/android-sdk}"
BT="$ANDROID_SDK_ROOT/build-tools/35.0.0"
AJAR="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"

rm -rf obj dex assets base.apk starfall-unsigned.apk res-compiled.zip
mkdir -p obj dex assets

# stage the web game
cp ../index.html assets/
cp -r ../css assets/
cp -r ../js assets/
# stage real game assets (audio/sprites/bg/ui) — the road to 100MB (ASSETS.md)
if [ -d ../assets ] && [ -n "$(ls -A ../assets 2>/dev/null)" ]; then
  cp -r ../assets/* assets/
fi
# EXCLUDE in-progress art pipelines (added 2026-10-20): assets/sprites/{ships-v2,fx-v2,celestial-v2}/
# are the user's separate sprite waves — NOT wired into the game (no js/index.html/ASSETS.md
# reference) and NOT in the loop's shipped manifest. Bundling them ballooned the APK 43MB -> 573MB.
# Lift these exclusions when the v2 art is wired in (the user's call). Also drop pipeline tooling
# (*.py) and raw/ source dirs — build inputs, not game assets.
rm -rf assets/sprites/ships-v2 assets/sprites/fx-v2 assets/sprites/celestial-v2
find assets -name '*.py' -delete
find assets -type d -name raw -exec rm -rf {} + 2>/dev/null || true
[ -f assets/index.html ] && [ -d assets/js ] || { echo "web tree missing"; exit 1; }

# reuse vendored WebView/Core jars (copied, omni-trip's copies untouched)
mkdir -p libs
for f in webkit-classes.jar core-classes.jar annotation-1.7.0.jar; do
  [ -f "libs/$f" ] || cp "$HOME/workspace/omni-trip/android/libs/$f" libs/
done
DEPS="libs/webkit-classes.jar:libs/core-classes.jar:libs/annotation-1.7.0.jar"

javac -encoding UTF-8 -source 8 -target 8 -nowarn \
  -cp "$AJAR:$DEPS" \
  -d obj src/com/dogbyte/starfall/*.java

"$BT/d8" --min-api 26 --lib "$AJAR" --output dex \
  obj/com/dogbyte/starfall/*.class libs/webkit-classes.jar libs/core-classes.jar

# launcher icon resources (res/mipmap-*/ic_launcher*.png, added 2026-10-22)
RES_ARG=""
if [ -d res ]; then
  "$BT/aapt2" compile --dir res -o res-compiled.zip
  RES_ARG="res-compiled.zip"
fi

"$BT/aapt2" link -o base.apk -I "$AJAR" --manifest AndroidManifest.xml \
  --min-sdk-version 26 --target-sdk-version 35 \
  --version-code 10 --version-name "1.8" $RES_ARG

python3 - << 'EOF'
import zipfile, os
with zipfile.ZipFile('base.apk', 'a') as z:
    z.write('dex/classes.dex', 'classes.dex')
    for dp, dn, fn in os.walk('assets'):
        for f in sorted(fn):
            full = os.path.join(dp, f)
            z.write(full, os.path.relpath(full, '.'),
                    compress_type=zipfile.ZIP_DEFLATED)
print('packaged')
EOF

"$BT/zipalign" -f 4 base.apk starfall-unsigned.apk
# Persistent STARFALL key (2nd generation — the 2026-10-18 keystore was lost in
# the tree wipe; uninstall the old copy before installing this build).
# Password lives in .keypass (0600), never in chat or logs.
if [ ! -f starfall.keystore ]; then
  [ -f .keypass ] || { echo "missing .keypass — create it first (0600)"; exit 1; }
  keytool -genkeypair -keystore starfall.keystore \
    -alias starfall -storepass:file .keypass -keypass:file .keypass \
    -keyalg RSA -keysize 2048 -validity 10950 -dname "CN=STARFALL,O=DOGBYTE,C=US"
  chmod 600 starfall.keystore
fi
"$BT/apksigner" sign --ks starfall.keystore --ks-pass file:.keypass \
  --out starfall.apk starfall-unsigned.apk
"$BT/apksigner" verify starfall.apk && echo BUILD_OK
ls -la starfall.apk
md5sum starfall.apk
