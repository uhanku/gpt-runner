#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

shopt -s nullglob

build_scripts=("$script_dir"/build-*.sh)

for script in "${build_scripts[@]}"; do
  if [[ "$script" == "$script_dir/build-all.sh" ]]; then
    continue
  fi

  bash "$script"
done
