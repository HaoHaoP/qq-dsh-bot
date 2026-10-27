#!/bin/bash
# 验收：每个插件目录都必须有 package.json，且各自的单测全绿。
set -e
cd "$(dirname "$0")/.."
export PATH="/Users/haohaop/.nvm/versions/node/v22.20.0/bin:$PATH"

found=0
for dir in plugins/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  if [ ! -f "$dir/package.json" ]; then
    echo "FAIL: $name 缺 package.json"
    exit 1
  fi
  found=$((found+1))
  echo "=== $name"
  ( cd "$dir" \
    && if [ -f package.json ] && grep -q '"build"' package.json; then npm run build >/dev/null 2>&1 || { echo "FAIL: $name 编译失败"; exit 1; }; fi \
    && node --test tests/ 2>&1 | tail -6 )
done

if [ "$found" -eq 0 ]; then
  echo "FAIL: plugins/ 下没有任何插件"
  exit 1
fi
echo "plugins checked: $found"
