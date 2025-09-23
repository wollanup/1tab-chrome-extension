#!/bin/bash
# Script to generate PNG icons from SVG source files
# define root path of project as parent of the directory containing this script
ROOT_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_PATH" || exit 1
convert -background none src/icons/icon.svg -resize 16x16 src/icons/icon16.png
convert -background none src/icons/icon.svg -resize 48x48 src/icons/icon48.png
convert -background none src/icons/icon.svg -resize 128x128 src/icons/icon128.png

convert -background none src/icons/icon-paused.svg -resize 16x16 src/icons/icon16-paused.png
convert -background none src/icons/icon-paused.svg -resize 48x48 src/icons/icon48-paused.png
convert -background none src/icons/icon-paused.svg -resize 128x128 src/icons/icon128-paused.png
