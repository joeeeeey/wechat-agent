#!/bin/bash
set -euo pipefail
if [ "$(uname -s)" != Darwin ]; then
  echo 'This installer currently supports macOS only.' >&2
  exit 1
fi
umask 077
install_home="${WECHAT_AGENT_HOME:-$HOME/.local/share/wechat-agent}"
mkdir -p "$install_home/tools" "$install_home/releases" "$install_home/bin"
bootstrap_tmp="$(mktemp -d "${TMPDIR:-/tmp}/wechat-agent-setup.XXXXXX")"
trap 'rm -rf "$bootstrap_tmp"' EXIT

# Native CLI users may not have Node. Install a private, checksum-verified Node 22.
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  case "$(uname -m)" in arm64) node_arch=arm64 ;; x86_64) node_arch=x64 ;; *) echo 'Unsupported Mac architecture' >&2; exit 1 ;; esac
  curl --fail --silent --show-error --location 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' -o "$bootstrap_tmp/SHASUMS256.txt"
  node_archive="$(awk -v suffix="-darwin-$node_arch.tar.gz" '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-darwin-(arm64|x64)\.tar\.gz$/ && index($2,suffix) {print $2}' "$bootstrap_tmp/SHASUMS256.txt")"
  if [ -z "$node_archive" ] || [[ "$node_archive" == *$'\n'* ]]; then echo 'Cannot resolve Node archive' >&2; exit 1; fi
  curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v22.x/$node_archive" -o "$bootstrap_tmp/$node_archive"
  awk -v archive="$node_archive" '$2==archive {print}' "$bootstrap_tmp/SHASUMS256.txt" > "$bootstrap_tmp/checksum.txt"
  (cd "$bootstrap_tmp" && shasum -a 256 -c checksum.txt)
  tar -xzf "$bootstrap_tmp/$node_archive" -C "$bootstrap_tmp"
  node_dir="${node_archive%.tar.gz}"
  if [ ! -d "$install_home/tools/$node_dir" ]; then mv "$bootstrap_tmp/$node_dir" "$install_home/tools/$node_dir"; fi
  export PATH="$install_home/tools/$node_dir/bin:$PATH"
fi

# Stop an existing installation before replacing code/skill paths.
WECHAT_AGENT_HOME="$install_home" node - <<'NODE'
const fs=require('node:fs'),path=require('node:path');
const base=process.env.WECHAT_AGENT_HOME;
for(const file of ['session.lock','watch/supervisor.json','watch/browser-process.json']){
 const p=path.join(base,file);if(!fs.existsSync(p))continue;
 const value=JSON.parse(fs.readFileSync(p,'utf8'));const pid=typeof value==='number'?value:value.pid;
 if(!Number.isInteger(pid))continue;
 let running=false;try{process.kill(pid,0);running=true;}catch(e){if(e.code!=='ESRCH')throw e;}
 if(running){console.error('A WeChat controller/browser is still running. Stop and close that dedicated browser before upgrading.');process.exit(1);}
}
NODE

curl --fail --silent --show-error --location 'https://codeload.github.com/joeeeeey/wechat-agent/tar.gz/refs/heads/main' -o "$bootstrap_tmp/source.tar.gz"
tar -xzf "$bootstrap_tmp/source.tar.gz" -C "$bootstrap_tmp"
release_dir="$install_home/releases/$(date +%Y%m%d-%H%M%S)-$$"
mv "$bootstrap_tmp/wechat-agent-main" "$release_dir"
(cd "$release_dir" && npm ci && npx playwright install chromium)
if [ -e "$install_home/app" ] && [ ! -L "$install_home/app" ]; then echo 'Existing app path is not an installer-owned symlink; leaving it untouched.' >&2; exit 1; fi
ln -sfn "$release_dir" "$install_home/app"
export WECHAT_AGENT_HOME="$install_home"
node "$install_home/app/scripts/setup.mjs"
