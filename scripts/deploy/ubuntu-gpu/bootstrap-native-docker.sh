#!/usr/bin/env bash
set -Eeuo pipefail

# Ubuntu host bootstrap for this project. Default mode is read-only planning.
# It never accepts or reads a sudo password from arguments or environment.

DO_INSTALL=0
ADD_DOCKER_GROUP=0
VERIFY_GPU=0
DOCKER_HOST_URI='unix:///var/run/docker.sock'
DOCKER_BIN='/usr/bin/docker'
NVIDIA_LIST='/etc/apt/sources.list.d/nvidia-container-toolkit.list'
NVIDIA_KEY='/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg'
DAEMON_JSON='/etc/docker/daemon.json'
DOCKER_DATA='/var/lib/docker'
CONTAINERD_DATA='/var/lib/containerd'
BACKUP_ROOT='/var/backups/audio-remix-lab-codex'
DOCKER_CE_VERSION='5:29.9.2-1~ubuntu.26.04~resolute'
CONTAINERD_VERSION='2.4.2-3~ubuntu.26.04~resolute'
NVIDIA_TOOLKIT_VERSION='1.20.1-1'

usage() {
  cat <<'USAGE'
Usage: bootstrap-native-docker.sh [--install] [--add-docker-group] [--verify-gpu]

Default: print a dry-run plan and local apt-cache candidates only.
--install: interactively request sudo locally, install/configure the native
           Docker Engine and NVIDIA Container Toolkit, then enable/start Docker.
--add-docker-group: explicitly add the current user to docker after installation.
                    This grants host-administrator/root-equivalent control.
--verify-gpu: after install, optionally pull/run a CUDA 12.6 nvidia-smi smoke image.

Do not run through a pipe. Do not provide a password in chat or command arguments.
USAGE
}

fail() { printf 'STOP: %s\n' "$*" >&2; exit 2; }

while (($#)); do
  case "$1" in
    --install) DO_INSTALL=1 ;;
    --add-docker-group) ADD_DOCKER_GROUP=1 ;;
    --verify-gpu) VERIFY_GPU=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "unknown option: $1" ;;
  esac
  shift
done

if ((ADD_DOCKER_GROUP && ! DO_INSTALL)); then
  fail '--add-docker-group requires --install'
fi
if ((VERIFY_GPU && ! DO_INSTALL)); then
  fail '--verify-gpu requires --install'
fi

installed_version() {
  dpkg-query -W -f='${Version}' "$1" 2>/dev/null || true
}

candidate_version() {
  apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/ {print $2; exit}'
}

print_pkg_state() {
  local package="$1" installed candidate
  installed="$(installed_version "$package")"
  candidate="$(candidate_version "$package")"
  printf '  %-34s installed=%-32s candidate=%s\n' "$package" "${installed:-none}" "${candidate:-none}"
}

safety_state() {
  local service
  printf 'Host safety preflight (read-only):\n'
  for service in docker containerd; do
    local state
    state="$(systemctl is-active "$service" 2>/dev/null || true)"
    [[ -n "$state" ]] || state=unknown
    printf '  systemd service %-12s %s\n' "$service" "$state"
  done
  printf '  dockerd process: '
  if pgrep -x dockerd >/dev/null 2>&1; then printf 'present\n'; else printf 'absent\n'; fi
  printf '  Docker socket: '
  if [[ -S /var/run/docker.sock ]]; then printf 'present\n'; else printf 'absent\n'; fi
  printf '  %s: ' "$DAEMON_JSON"
  if [[ -e "$DAEMON_JSON" ]]; then printf 'present (must be backed up and reviewed; script stops)\n'; else printf 'absent\n'; fi
  for path in "$DOCKER_DATA" "$CONTAINERD_DATA"; do
    printf '  %s: ' "$path"
    if [[ -e "$path" ]]; then printf 'present (script stops; existing root data is never reused)\n'; else printf 'absent\n'; fi
  done
  printf '  Docker context selection: not used by bootstrap; all native calls pin --host %s\n' "$DOCKER_HOST_URI"
  printf '  CLI executable: %s (the existing /usr/local/bin/docker is not changed)\n' "$DOCKER_BIN"
}

if ((! DO_INSTALL)); then
  printf 'DRY RUN ONLY: no network, sudo, package install, config write, service start, or Docker command.\n'
  safety_state
  printf '\nPackage state and locally cached apt candidates:\n'
  for package in docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    nvidia-container-toolkit nvidia-container-toolkit-base libnvidia-container-tools libnvidia-container1; do
    print_pkg_state "$package"
  done
  cat <<'PLAN'

Planned explicit --install sequence:
  1. Require an interactive terminal and request sudo authorization locally.
  2. Stop before installation if dockerd/containerd is active, a Docker socket exists,
     /var/lib/docker or /var/lib/containerd exists, or /etc/docker/daemon.json exists.
     If daemon.json exists, make a root-only timestamped backup, print its path and stop.
  3. Add NVIDIA's official apt repository only when its source/keyring are both absent;
     never overwrite a partial/existing source or key. Refresh apt metadata.
  4. Install NVIDIA Container Toolkit packages pinned to 1.20.1-1; abort if any
     official-repo apt candidate differs. Run nvidia-ctk runtime configure --runtime=docker.
     Do not set rootless/no-cgroups options. Save a root-only copy of the generated
     daemon config before installing/starting Engine.
  5. Install docker-ce/docker-ce-cli 5:29.9.2-1~ubuntu.26.04~resolute and
     containerd.io 2.4.2-3~ubuntu.26.04~resolute only; abort on candidate mismatch.
     Keep already working buildx and Compose plugin; no global Python/uv installation.
  6. Enable/start the native docker service and verify using /usr/bin/docker with an
     explicit unix socket, without modifying the Docker Desktop context or shim.
  7. Add frank to the docker group only when --add-docker-group is explicitly
     provided; membership grants host-administrator powers. No group change is default.
  8. Pull/run the CUDA 12.6 nvidia-smi utility image only with --verify-gpu.

No Docker Desktop VM, containers, volumes, or context are inspected through its socket,
modified, deleted, or used by this bootstrap.
PLAN
  exit 0
fi

[[ -t 0 && -t 1 ]] || fail '--install requires an interactive terminal so sudo can prompt locally'
((EUID != 0)) || fail 'run as the regular user; this script prompts for sudo itself'
[[ "$(uname -s)" == Linux ]] || fail '--install is supported only on Linux'
[[ "$(dpkg --print-architecture 2>/dev/null || true)" == amd64 ]] || fail 'expected Ubuntu amd64/x86_64'
[[ -x "$DOCKER_BIN" ]] || fail "expected existing CLI at $DOCKER_BIN; refusing to change PATH or Desktop shim"
[[ -f /etc/os-release ]] || fail 'cannot identify Ubuntu release'
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 26.04 ]] || fail "expected Ubuntu 26.04; detected ${ID:-unknown} ${VERSION_ID:-unknown}"
[[ -f /etc/apt/sources.list.d/docker.sources ]] || fail 'official Docker apt source file is absent; review host package sources first'

sudo -v || fail 'sudo authorization failed'

# Never connect to or initialize an existing daemon. Back up any old daemon config,
# but stop before changing it or installing packages that might start Docker.
if sudo test -e "$DAEMON_JSON"; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  sudo install -d -m 700 "$BACKUP_ROOT"
  backup="$BACKUP_ROOT/daemon.json.before-bootstrap.$stamp"
  sudo cp -a -- "$DAEMON_JSON" "$backup"
  printf 'Backed up existing daemon configuration to %s (root-only).\n' "$backup" >&2
  fail 'existing daemon.json requires manual review; no package install or service start was attempted'
fi
if sudo pgrep -x dockerd >/dev/null 2>&1 || systemctl is-active --quiet docker 2>/dev/null || sudo test -S /var/run/docker.sock; then
  fail 'a native Docker daemon/service/socket is already present; inspect its owner/data before proceeding'
fi
if systemctl is-active --quiet containerd 2>/dev/null; then
  fail 'containerd service is active; inspect its owner/data before proceeding'
fi
if systemctl --user is-active --quiet docker-desktop 2>/dev/null; then
  fail 'Docker Desktop user service is active; stop/review it manually before native Engine bootstrap'
fi
for path in "$DOCKER_DATA" "$CONTAINERD_DATA"; do
  ! sudo test -e "$path" || fail "$path exists; existing root Docker/containerd state is not assumed empty and was not touched"
done

# NVIDIA repository/keyring: use official URLs, never replace partial or custom config.
if [[ -e "$NVIDIA_LIST" || -e "$NVIDIA_KEY" ]]; then
  [[ -f "$NVIDIA_LIST" && -f "$NVIDIA_KEY" ]] || fail 'partial NVIDIA apt source/keyring exists; review manually, refusing to overwrite'
  grep -Fq 'nvidia.github.io/libnvidia-container/stable/deb' "$NVIDIA_LIST" || fail 'existing NVIDIA apt source is not the expected official stable source; review manually'
else
  for tool in curl gpg; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is missing; install/review the prerequisite manually before rerunning"; done
  [[ -r /etc/ssl/certs/ca-certificates.crt ]] || fail 'ca-certificates bundle missing; install/review it manually before rerunning'
  tmpdir="$(mktemp -d)"
  trap 'rm -rf -- "$tmpdir"' EXIT
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey -o "$tmpdir/nvidia.gpg.asc"
  gpg --dearmor --batch --yes -o "$tmpdir/nvidia-container-toolkit-keyring.gpg" "$tmpdir/nvidia.gpg.asc"
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list -o "$tmpdir/nvidia-container-toolkit.list.upstream"
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    "$tmpdir/nvidia-container-toolkit.list.upstream" > "$tmpdir/nvidia-container-toolkit.list"
  sudo install -D -m 644 "$tmpdir/nvidia-container-toolkit-keyring.gpg" "$NVIDIA_KEY"
  sudo install -D -m 644 "$tmpdir/nvidia-container-toolkit.list" "$NVIDIA_LIST"
fi

sudo apt-get update

packages_to_install=()
add_candidate_if_needed() {
  local package="$1" candidate installed
  candidate="$(candidate_version "$package")"
  [[ -n "$candidate" && "$candidate" != '(none)' ]] || fail "no apt candidate found for $package after repository refresh"
  installed="$(installed_version "$package")"
  if [[ "$installed" != "$candidate" ]]; then
    packages_to_install+=("$package=$candidate")
  fi
}

add_pinned_if_needed() {
  local package="$1" expected="$2" candidate installed
  candidate="$(candidate_version "$package")"
  [[ "$candidate" == "$expected" ]] || fail "$package candidate is ${candidate:-missing}; reviewed plan pins $expected"
  installed="$(installed_version "$package")"
  if [[ "$installed" == "$expected" ]]; then
    return 0
  fi
  [[ -z "$installed" ]] || fail "$package is installed at $installed; refusing an implicit upgrade/downgrade to $expected"
  packages_to_install+=("$package=$expected")
}

simulate_apt_install() {
  local simulation line package requested_version simulated_version requested argument
  simulation="$(sudo apt-get -s --no-install-recommends install "$@")" || fail 'apt install simulation failed'
  if grep -q '^Remv ' <<<"$simulation"; then
    fail 'apt simulation would remove existing packages; no packages installed'
  fi
  while IFS= read -r line; do
    [[ "$line" == Inst\ * ]] || continue
    package="${line#Inst }"
    package="${package%% *}"
    package="${package%%:*}"
    case "$package" in
      docker-ce-cli)
        fail 'apt simulation would alter the existing Docker CLI package; no packages installed'
        ;;
      docker-buildx-plugin|docker-compose-plugin)
        requested=0
        requested_version=''
        for argument in "$@"; do
          if [[ "${argument%%=*}" == "$package" && "$argument" == *=* ]]; then
            requested=1
            requested_version="${argument#*=}"
            break
          fi
        done
        [[ -z "$(installed_version "$package")" && "$requested" == 1 ]] || \
          fail "apt simulation would alter an installed or unrequested $package; no packages installed"
        simulated_version="${line#*(}"
        simulated_version="${simulated_version%% *}"
        [[ "$simulated_version" == "$requested_version" ]] || \
          fail "apt simulation selected an unexpected $package version; no packages installed"
        ;;
    esac
  done <<<"$simulation"
}

for package in nvidia-container-toolkit nvidia-container-toolkit-base \
  libnvidia-container-tools libnvidia-container1; do
  add_pinned_if_needed "$package" "$NVIDIA_TOOLKIT_VERSION"
done
if ((${#packages_to_install[@]})); then
  simulate_apt_install "${packages_to_install[@]}"
  sudo apt-get install -y --no-install-recommends "${packages_to_install[@]}"
fi

! sudo test -e "$DAEMON_JSON" || fail 'daemon.json appeared before NVIDIA runtime configuration; stop and review it'
if ! sudo nvidia-ctk runtime configure --runtime=docker; then
  if sudo test -e "$DAEMON_JSON"; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    sudo install -d -m 700 "$BACKUP_ROOT"
    sudo cp -a -- "$DAEMON_JSON" "$BACKUP_ROOT/daemon.json.partial-after-nvidia.$stamp"
    printf 'Partial daemon config backed up to %s\n' "$BACKUP_ROOT/daemon.json.partial-after-nvidia.$stamp" >&2
  fi
  fail 'nvidia-ctk runtime configure failed; Docker Engine was not installed or started'
fi
sudo test -f "$DAEMON_JSON" || fail 'nvidia-ctk did not create the expected Docker runtime config'
sudo python3 -m json.tool "$DAEMON_JSON" >/dev/null
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 700 "$BACKUP_ROOT"
sudo cp -a -- "$DAEMON_JSON" "$BACKUP_ROOT/daemon.json.generated-for-nvidia.$stamp"

# Recheck before apt can auto-start a newly installed Docker daemon.
! sudo test -e "$DOCKER_DATA" && ! sudo test -e "$CONTAINERD_DATA" || fail 'Docker/containerd data path appeared during bootstrap; will not install/start Engine'
packages_to_install=()
add_pinned_if_needed docker-ce "$DOCKER_CE_VERSION"
add_pinned_if_needed docker-ce-cli "$DOCKER_CE_VERSION"
add_pinned_if_needed containerd.io "$CONTAINERD_VERSION"
if [[ -z "$(installed_version docker-buildx-plugin)" ]]; then add_candidate_if_needed docker-buildx-plugin; fi
if [[ -z "$(installed_version docker-compose-plugin)" ]]; then add_candidate_if_needed docker-compose-plugin; fi
if ((${#packages_to_install[@]})); then
  simulate_apt_install "${packages_to_install[@]}"
  sudo apt-get install -y --no-install-recommends "${packages_to_install[@]}"
fi

sudo systemctl enable --now docker
sudo "$DOCKER_BIN" --host "$DOCKER_HOST_URI" info --format '{{.ServerVersion}} {{.OperatingSystem}}'
sudo nvidia-ctk --version
"$DOCKER_BIN" buildx version >/dev/null 2>&1 || fail 'installed buildx command is not usable'
"$DOCKER_BIN" compose version >/dev/null 2>&1 || fail 'installed Compose command is not usable'

if ((ADD_DOCKER_GROUP)); then
  printf '\nWARNING: --add-docker-group grants %s host-administrator/root-equivalent control.\n' "$(id -un)"
  sudo usermod -aG docker "$(id -un)"
  printf 'Added %s to docker group; log out and back in before using it.\n' "$(id -un)"
else
  printf 'No docker-group membership change. Use sudo /usr/bin/docker --host %s for Docker commands.\n' "$DOCKER_HOST_URI"
fi

if ((VERIFY_GPU)); then
  sudo "$DOCKER_BIN" --host "$DOCKER_HOST_URI" run --rm --gpus all --pull=missing \
    nvidia/cuda:12.6.2-base-ubuntu24.04 nvidia-smi
fi
