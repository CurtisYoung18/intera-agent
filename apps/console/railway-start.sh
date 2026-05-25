#!/bin/sh
set -e
cp -r apps/console/.next/standalone/. .
sh apps/console/entrypoint.sh
