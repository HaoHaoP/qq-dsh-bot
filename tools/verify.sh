#!/bin/bash
# 验收：quota-gate 插件必须存在，且单测全绿。
set -e
cd "$(dirname "$0")/.."
export PATH="/Users/haohaop/.nvm/versions/node/v22.20.0/bin:$PATH"

if [ ! -f plugins/quota-gate/package.json ]; then
  echo "FAIL: plugins/quota-gate/package.json 不存在（插件还没建）"
  exit 1
fi

cd plugins/quota-gate
node --version
node --test tests/ 2>&1 | tail -25
