#!/usr/bin/env bash
# Installs the THE MAX MIX kiosk with ansible-pull. Run as root by the-max-mix-bootstrap.service, which loads its settings
# from /etc/the-max-mix/bootstrap.env (KIOSK_URL, PLAYBOOK_REPO, PLAYBOOK_REF, KIOSK_USER).
#
# It keeps /var/lib/the-max-mix/status.json up to date for the first-boot screen. Only a successful ansible-pull writes
# the done marker /var/lib/the-max-mix/bootstrapped; until then systemd retries with a growing delay.
#
# Exit codes: 0 done, 75 no internet yet (retry), 78 a setting is invalid (no retry), 1 ansible-pull failed (retry).
set -euo pipefail

state_dir=/var/lib/the-max-mix
status_file=$state_dir/status.json
marker=$state_dir/bootstrapped
checkout=$state_dir/playbook
log_file=$state_dir/last-run.log
attempts_file=$state_dir/attempts

# Same character sets as the Ansible role, so a value is safe in JSON, in the unit files and in the shell.
url_pattern='^(https://[A-Za-z0-9._~:/?&=+,@-]+|http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/[A-Za-z0-9._~:/?&=+,@-]*)?)$'
repo_pattern='^https://[A-Za-z0-9._~:/@-]+$'
ref_pattern='^[A-Za-z0-9][A-Za-z0-9._/-]*$'
user_pattern='^[a-z_][a-z0-9_-]*$'

if [[ -e $marker ]]; then
  exit 0
fi

mkdir -p "$state_dir"
chmod 755 "$state_dir"

previous_state=$(sed -n 's/.*"state":"\([a-z_]*\)".*/\1/p' "$status_file" 2>/dev/null || true)
attempt=$(($(cat "$attempts_file" 2>/dev/null || echo 0) + 1))
echo "$attempt" >"$attempts_file"

# state, message shown on the touchscreen, optional technical detail (made safe for JSON and cut short).
write_status() {
  local state=$1 message=$2 detail=${3:-}
  detail=$(printf '%s' "$detail" | tr '[:cntrl:]' ' ' | tr -d '"\134' | cut -c1-300)
  printf '{"state":"%s","message":"%s","detail":"%s","attempt":%s,"updated":%s}\n' \
    "$state" "$message" "$detail" "$attempt" "$(date +%s)" >"$status_file.tmp"
  chmod 644 "$status_file.tmp"
  mv -f "$status_file.tmp" "$status_file"
}

bad_setting() {
  echo "$1" >&2
  write_status failed "A setting in /etc/the-max-mix/bootstrap.env is not valid." "$1"
  exit 78
}

kiosk_url=${KIOSK_URL:-https://the-max-mix.vercel.app/}
repo=${PLAYBOOK_REPO:-https://github.com/nvorkinn/the-max-mix.git}
ref=${PLAYBOOK_REF:-main}
user=${KIOSK_USER:-}

[[ $kiosk_url =~ $url_pattern ]] || bad_setting "KIOSK_URL is not a plain https address: $kiosk_url"
[[ $repo =~ $repo_pattern ]] || bad_setting "PLAYBOOK_REPO is not a plain https address: $repo"
[[ $ref =~ $ref_pattern ]] || bad_setting "PLAYBOOK_REF is not a branch or tag name: $ref"
# Empty means the first desktop user (uid 1000), whatever it is called: Raspberry Pi Imager can choose another name.
if [[ -z $user ]]; then
  user=$(getent passwd 1000 | cut -d: -f1 || true)
fi
[[ $user =~ $user_pattern ]] || bad_setting "KIOSK_USER is not a valid user name: ${user:-none found}"
[[ $user != root ]] || bad_setting "KIOSK_USER must be the desktop user, never root."
id -u "$user" >/dev/null 2>&1 || bad_setting "KIOSK_USER does not exist: $user"

# On a retry after "no internet" the first-boot screen keeps showing the Wi-Fi setup, so do not flip it to "starting".
if [[ $previous_state != waiting_for_network ]]; then
  write_status starting "Looking for an internet connection."
fi

host=${repo#https://}
host=${host%%/*}
host=${host%%:*}
deadline=$((SECONDS + 20))
until curl --silent --head --max-time 5 --output /dev/null "https://$host/"; do
  if ((SECONDS >= deadline)); then
    write_status waiting_for_network "No internet connection yet. Connect this Pi to your Wi-Fi to carry on."
    echo "No internet connection yet (could not reach $host)." >&2
    exit 75
  fi
  sleep 2
done

# A Pi has no battery clock, so certificates look "not yet valid" until the network time arrives. Give it a little while.
clock_deadline=$((SECONDS + 90))
until [[ $(timedatectl show --property=NTPSynchronized --value 2>/dev/null || echo yes) == yes ]]; do
  ((SECONDS < clock_deadline)) || break
  sleep 3
done

write_status running "Connecting, setting up THE MAX MIX. This takes a few minutes."
echo "Running ansible-pull: $repo at $ref for user $user, opening $kiosk_url"

# A half-finished clone from an earlier attempt would stop ansible-pull, so start that one over.
if [[ -d $checkout && ! -d $checkout/.git ]]; then
  rm -rf "$checkout"
fi

export LC_ALL=C.UTF-8 HOME=/root GIT_TERMINAL_PROMPT=0 ANSIBLE_NOCOLOR=1
extra_vars=$(printf '{"kiosk_url":"%s","kiosk_user":"%s"}' "$kiosk_url" "$user")
if ! ansible-pull -U "$repo" -C "$ref" -d "$checkout" -i localhost, -e "$extra_vars" ansible/local.yml 2>&1 | tee "$log_file"; then
  write_status failed "Setup did not finish. Trying again soon." "$(tail -n 4 "$log_file")"
  echo "ansible-pull failed (attempt $attempt)." >&2
  exit 1
fi

touch "$marker"
write_status "done" "All set. Starting THE MAX MIX."
echo "THE MAX MIX is installed."
