#!/bin/sh
export CI=true
export CONFIRM_MODULES_PURGE=false
exec pnpm "$@"
