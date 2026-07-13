#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"secretsmanager get-secret-value"*"--secret-id arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd"*)
    printf '{"BINANCE_API_KEY":"FAKE_API_KEY_123456","BINANCE_API_SECRET":"FAKE_SECRET_123456"}\n'
    ;;
  *) exit 9 ;;
esac
