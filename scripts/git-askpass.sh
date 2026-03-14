#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

prompt="${1:-}"

case "${prompt}" in
  *Username* )
    printf '%s\n' "${GITHUB_USERNAME:-renelwllms}"
    ;;
  *Password* )
    if [ -z "${GITHUB_PAT:-}" ]; then
      printf 'GITHUB_PAT is not set in %s\n' "${ENV_FILE}" >&2
      exit 1
    fi
    printf '%s\n' "${GITHUB_PAT}"
    ;;
  * )
    exit 1
    ;;
esac
