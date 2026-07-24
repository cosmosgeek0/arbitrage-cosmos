#!/usr/bin/env bash
set -euo pipefail
case "$(basename "$0"):$*" in
  aws-wrong-role.sh:*"sts get-caller-identity"*)
    printf '{"Account":"123456789012","Arn":"arn:aws:sts::123456789012:assumed-role/other-instance-role/session-001","UserId":"ROLEID:session-001"}\n'
    ;;
  *:*"sts get-caller-identity"*)
    printf '{"Account":"123456789012","Arn":"arn:aws:sts::123456789012:assumed-role/cosmos-instance-role/session-001","UserId":"ROLEID:session-001"}\n'
    ;;
  *:*"secretsmanager get-secret-value"*"--secret-id arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd"*)
    printf '{"BINANCE_API_KEY":"FAKE_API_KEY_123456","BINANCE_API_SECRET":"FAKE_SECRET_123456"}\n'
    ;;
  *) exit 9 ;;
esac
